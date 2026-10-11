import type { Point3 } from "@tscircuit/math-utils"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import type { HighDensityIntraNodeRoute, Jumper } from "lib/types/high-density-types"
import { MinHeap } from "tiny-hypergraph/lib/MinHeap"
import type { IsStitchSegmentClear } from "./route-stitch-clearance-validator"
import { compareRoutes, DISTANCE_TIE_TOLERANCE, MAX_STITCH_GAP_DISTANCE_3,
  MAX_TERMINAL_STITCH_GAP_DISTANCE_3 } from "./routeStitchingShared"

type RoutePoint = HighDensityIntraNodeRoute["route"][number]
type Terminal = Point3 & { pcb_port_id?: string }
type Node = { point: RoutePoint; pcbPortId?: string }
type Edge = { target: number; cost: number; routeIndex?: number;
  points: RoutePoint[]; vias: HighDensityIntraNodeRoute["vias"]; jumpers: Jumper[] }
type Connector = Pick<Edge, "cost" | "points" | "vias" | "jumpers">

export type PhysicalStitchPathOptions = {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Terminal
  end: Terminal
  traceThickness: number
  allowedLayerTransitionPointKeys?: Set<string>
  isStitchSegmentClear: IsStitchSegmentClear
  stitchClearanceMode: "require_clear" | "prefer_clear"
  onBlockedConnector?: (reason: "layer-transition" | "clearance" | "unreachable") => void
}

export type PhysicalStitchPath = {
  route: HighDensityIntraNodeRoute["route"]
  vias: HighDensityIntraNodeRoute["vias"]
  jumpers: Jumper[]
  /** Original input indexes, retained in traversal order. */
  routeIndexes: number[]
}

const GEOMETRIC_TOLERANCE = 1e-3
const GAP_PENALTY = 100000
const VIA_PENALTY = 1000
const COLLISION_PENALTY = MAX_STITCH_GAP_DISTANCE_3 + DISTANCE_TIE_TOLERANCE

function reversePoints(points: RoutePoint[]): RoutePoint[] {
  const result = points.toReversed().map((point): RoutePoint => {
    const { toNextSegmentType, toNextSegmentCircuitJsonMetadata, ...rest } = point
    return { ...rest }
  })
  for (let i = 0; i < points.length - 1; i++) {
    const original = points[i]!
    const reversed = result[points.length - i - 2]!
    if (original.toNextSegmentType) reversed.toNextSegmentType = original.toNextSegmentType
    if (original.toNextSegmentCircuitJsonMetadata) {
      reversed.toNextSegmentCircuitJsonMetadata = original.toNextSegmentCircuitJsonMetadata
    }
  }
  return result
}

function fragmentCost(options: PhysicalStitchPathOptions, route: HighDensityIntraNodeRoute): number {
  let cost = 0
  for (let index = 0; index + 1 < route.route.length; index++) {
    const start = route.route[index]!
    const end = route.route[index + 1]!
    cost += Math.hypot(start.x - end.x, start.y - end.y)
    if (start.z === end.z && start.toNextSegmentType !== "through_obstacle" &&
      !(start.insideJumperPad && end.insideJumperPad) &&
      !options.isStitchSegmentClear({ connectionName: options.connectionName,
        start, end, traceThickness: route.traceThickness })) {
      cost += COLLISION_PENALTY
    }
  }
  if (!Number.isFinite(cost)) throw new Error(`Invalid route fragment cost for "${options.connectionName}"`)
  return cost
}

function planarCost(options: PhysicalStitchPathOptions, from: Point3, to: Point3,
  maximumDistance: number): number | null {
  const distance = Math.hypot(from.x - to.x, from.y - to.y)
  if (distance > maximumDistance) {
    options.onBlockedConnector?.("unreachable")
    return null
  }
  if (distance < GEOMETRIC_TOLERANCE) return distance
  const clear = options.isStitchSegmentClear({ connectionName: options.connectionName,
    start: from, end: to, traceThickness: options.traceThickness })
  if (!clear && options.stitchClearanceMode === "require_clear") {
    options.onBlockedConnector?.("clearance")
    return null
  }
  return GAP_PENALTY + (clear ? 0 : COLLISION_PENALTY) + distance
}

function endpointConnector(options: PhysicalStitchPathOptions, from: Point3, to: Point3): Connector | null {
  const fromPoint = { x: from.x, y: from.y, z: from.z }
  const toPoint = { x: to.x, y: to.y, z: to.z }
  if (from.z === to.z) {
    const cost = planarCost(options, from, to, MAX_STITCH_GAP_DISTANCE_3)
    return cost === null ? null : { cost, points: [fromPoint, toPoint], vias: [], jumpers: [] }
  }
  const distance = Math.hypot(from.x - to.x, from.y - to.y)
  if (distance >= GEOMETRIC_TOLERANCE) return null
  const candidates = [from, to].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
  const via = candidates.find((point) => !options.allowedLayerTransitionPointKeys ||
    options.allowedLayerTransitionPointKeys.has(getXyPointKey(point)))
  if (!via) {
    options.onBlockedConnector?.("layer-transition")
    return null
  }
  const beforeVia = { x: via.x, y: via.y, z: from.z }
  const afterVia = { x: via.x, y: via.y, z: to.z }
  return { cost: VIA_PENALTY + distance, points: [fromPoint, beforeVia, afterVia, toPoint],
    vias: [{ x: via.x, y: via.y }], jumpers: [] }
}

function terminalConnector(options: PhysicalStitchPathOptions, terminal: Terminal, endpoint: Node): Connector | null {
  if (endpoint.pcbPortId && endpoint.pcbPortId !== terminal.pcb_port_id) return null
  // A terminal's routed tail establishes which layer can safely leave its pad.
  // A nearby endpoint on another layer cannot justify inventing a via at the
  // terminal and a new wire across that layer's pads. Existing coincident
  // endpoints can request a physical transition without replacing the tail.
  if (terminal.z !== endpoint.point.z &&
      Math.hypot(terminal.x - endpoint.point.x, terminal.y - endpoint.point.y) >= GEOMETRIC_TOLERANCE) return null
  const onEndpointLayer = { x: terminal.x, y: terminal.y, z: endpoint.point.z }
  const cost = planarCost(options, onEndpointLayer, endpoint.point, MAX_TERMINAL_STITCH_GAP_DISTANCE_3)
  if (cost === null) return null
  const terminalPoint = { x: terminal.x, y: terminal.y, z: terminal.z }
  const endpointPoint = { x: endpoint.point.x, y: endpoint.point.y, z: endpoint.point.z }
  if (terminal.z === endpoint.point.z) {
    return { cost, points: [terminalPoint, endpointPoint], vias: [], jumpers: [] }
  }
  if (options.allowedLayerTransitionPointKeys &&
      !options.allowedLayerTransitionPointKeys.has(getXyPointKey(terminal))) {
    options.onBlockedConnector?.("layer-transition")
    return null
  }
  return { cost: cost + VIA_PENALTY,
    points: [terminalPoint, onEndpointLayer, endpointPoint],
    vias: [{ x: terminal.x, y: terminal.y }], jumpers: [] }
}

function appendPoints(target: RoutePoint[], points: RoutePoint[]): void {
  for (const point of points) {
    const previous = target.at(-1)
    if (previous && point.x === previous.x && point.y === previous.y && point.z === previous.z) {
      delete previous.toNextSegmentType
      delete previous.toNextSegmentCircuitJsonMetadata
      Object.assign(previous, point)
    } else {
      target.push({ ...point })
    }
  }
}

/** Finds a physical terminal path without consuming branches greedily. */
export function findPhysicalStitchPath(options: PhysicalStitchPathOptions): PhysicalStitchPath | null {
  if (options.hdRoutes.length === 0) return null
  const canonical = options.hdRoutes.map((route, originalIndex) => ({ route, originalIndex }))
    .sort((a, b) => compareRoutes(a.route, b.route) || a.originalIndex - b.originalIndex)
  const nodes: Node[] = [
    { point: { x: options.start.x, y: options.start.y, z: options.start.z } },
    { point: { x: options.end.x, y: options.end.y, z: options.end.z } },
  ]
  const adjacency: Edge[][] = [[], []]
  for (const { route, originalIndex } of canonical) {
    if (route.route.length === 0) throw new Error(`Cannot stitch an empty route fragment for "${options.connectionName}"`)
    const first = nodes.length
    const last = first + 1
    nodes.push({ point: { ...route.route[0]! }, pcbPortId: route.startPcbPortId },
      { point: { ...route.route.at(-1)! }, pcbPortId: route.endPcbPortId })
    adjacency.push([], [])
    const points = route.route.map((point): RoutePoint => ({ ...point }))
    const cost = fragmentCost(options, route)
    const vias = route.vias.map((via) => ({ ...via }))
    const jumpers = (route.jumpers ?? []).map((jumper): Jumper => ({ ...jumper,
      start: { ...jumper.start }, end: { ...jumper.end } }))
    adjacency[first]!.push({ target: last, cost, routeIndex: originalIndex, points, vias, jumpers })
    adjacency[last]!.push({ target: first, cost, routeIndex: originalIndex,
      points: reversePoints(points), vias, jumpers: jumpers.toReversed().map((jumper): Jumper => ({ ...jumper,
        start: { ...jumper.end }, end: { ...jumper.start } })) })
  }
  for (let i = 2; i < nodes.length; i++) {
    const start = terminalConnector(options, options.start, nodes[i]!)
    if (start) adjacency[0]!.push({ target: i, ...start })
    const end = terminalConnector(options, options.end, nodes[i]!)
    if (end) adjacency[i]!.push({ target: 1, ...end, points: reversePoints(end.points) })
    for (let j = i + 1; j < nodes.length; j++) {
      const connector = endpointConnector(options, nodes[i]!.point, nodes[j]!.point)
      if (!connector) continue
      adjacency[i]!.push({ target: j, ...connector })
      adjacency[j]!.push({ target: i, ...connector, points: reversePoints(connector.points) })
    }
  }
  // A separate state bit requires actual routed copper, rather than accepting
  // two terminal connectors that happen to meet at an unused endpoint.
  const costs = new Float64Array(nodes.length * 2).fill(Infinity)
  const settled = new Uint8Array(costs.length)
  const previous: Array<{ state: number; edge: Edge } | undefined> = new Array(costs.length)
  const queue = new MinHeap<{ state: number; cost: number }>([],
    (a, b) => a.cost - b.cost || a.state - b.state)
  costs[0] = 0
  queue.queue({ state: 0, cost: 0 })
  const goalState = 3
  while (queue.length > 0) {
    const current = queue.dequeue()!
    if (settled[current.state] || current.cost !== costs[current.state]) continue
    settled[current.state] = 1
    if (current.state === goalState) break
    const usedFragment = (current.state & 1) !== 0
    for (const edge of adjacency[current.state >>> 1]!) {
      const nextUsedFragment = usedFragment || edge.routeIndex !== undefined
      if (edge.target === 1 && !nextUsedFragment) continue
      const targetState = edge.target * 2 + Number(nextUsedFragment)
      const cost = current.cost + edge.cost
      if (settled[targetState] || cost >= costs[targetState]!) continue
      costs[targetState] = cost
      previous[targetState] = { state: current.state, edge }
      queue.queue({ state: targetState, cost })
    }
  }
  if (!settled[goalState]) return null
  const edges: Edge[] = []
  let cursor = goalState
  while (cursor !== 0) {
    const preceding = previous[cursor]
    if (!preceding) throw new Error("Physical stitch path has an incomplete predecessor chain")
    edges.push(preceding.edge)
    cursor = preceding.state
  }
  const result: PhysicalStitchPath = { route: [], vias: [], jumpers: [], routeIndexes: [] }
  const viaKeys = new Set<string>()
  for (const edge of edges.reverse()) {
    appendPoints(result.route, edge.points)
    for (const via of edge.vias) {
      const key = `${via.x},${via.y}`
      if (viaKeys.has(key)) continue
      viaKeys.add(key)
      result.vias.push({ ...via })
    }
    result.jumpers.push(...edge.jumpers)
    if (edge.routeIndex !== undefined) result.routeIndexes.push(edge.routeIndex)
  }
  return result
}

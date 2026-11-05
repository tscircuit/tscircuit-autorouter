import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type {
  SimpleRouteConstraint,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type Vertex = { x: number; y: number; layer: string }
type Edge = { to: number; length: number; vias: number }
export type RouteConstraintMeasurement = {
  length: number
  vias: number
  satisfied: boolean
}

/** Measure routed paths in board-world mm (+X right, +Y up); via travel is included. */
export function measureRouteConstraint(
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  rule: SimpleRouteConstraint,
): RouteConstraintMeasurement {
  const connection = srj.connections.find(
    (candidate) => candidate.name === rule.connectionName,
  )
  if (!connection)
    throw new Error("Route constraint references a missing connection")
  const points = connection.pointsToConnect
  const constrained = rule.pointIds.map((pointId) => {
    const point = points.find(
      (candidate) =>
        candidate.pointId === pointId || candidate.pcb_port_id === pointId,
    )
    if (!point)
      throw new Error("Route constraint references a missing terminal")
    return point
  })
  if (constrained.length === 0)
    throw new Error("Route constraint requires at least one terminal")
  const connectivity = getConnectivityMapFromSimpleRouteJson({ ...srj, traces })
  const net = connectivity.getNetConnectedToId(connection.name)
  const vertices: Vertex[] = []
  const keys = new Map<string, number>()
  const adjacency: Edge[][] = []
  const addVertex = (point: Vertex): number => {
    const key = `${point.x.toFixed(7)},${point.y.toFixed(7)},${point.layer}`
    const existing = keys.get(key)
    if (existing !== undefined) return existing
    const index = vertices.length
    keys.set(key, index)
    vertices.push(point)
    adjacency.push([])
    return index
  }
  const addEdge = (
    a: number,
    b: number,
    length: number,
    vias: number,
  ): void => {
    adjacency[a]!.push({ to: b, length, vias })
    adjacency[b]!.push({ to: a, length, vias })
  }
  const segments: Array<[Vertex, Vertex]> = []
  let availableVias = 0
  for (const trace of traces) {
    if (!net || connectivity.getNetConnectedToId(trace.connection_name) !== net)
      continue
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index]!
      if (point.route_type === "via") {
        const from = addVertex({ ...point, layer: point.from_layer })
        const to = addVertex({ ...point, layer: point.to_layer })
        addEdge(from, to, srj.boardThickness ?? 1.6, 1)
        availableVias++
      } else if (point.route_type === "wire") {
        addVertex(point)
        const next = trace.route[index + 1]
        if (next?.route_type === "wire" && point.layer === next.layer)
          segments.push([point, next])
        if (
          next?.route_type === "via" &&
          [next.from_layer, next.to_layer].includes(point.layer)
        )
          segments.push([point, { ...next, layer: point.layer }])
        const previous = trace.route[index - 1]
        if (
          previous?.route_type === "via" &&
          [previous.from_layer, previous.to_layer].includes(point.layer)
        )
          segments.push([{ ...previous, layer: point.layer }, point])
      } else if (point.route_type === "through_obstacle") {
        const from = addVertex({ ...point.start, layer: point.from_layer })
        const to = addVertex({ ...point.end, layer: point.to_layer })
        addEdge(
          from,
          to,
          Math.hypot(point.end.x - point.start.x, point.end.y - point.start.y),
          0,
        )
      } else if (point.route_type === "jumper") {
        const from = addVertex({ ...point.start, layer: point.layer })
        const to = addVertex({ ...point.end, layer: point.layer })
        addEdge(
          from,
          to,
          Math.hypot(point.end.x - point.start.x, point.end.y - point.start.y),
          0,
        )
      }
    }
  }
  const pointVertices = points.map((point) =>
    getConnectionPointLayers(point).map((layer) =>
      addVertex({ ...point, layer }),
    ),
  )
  // Split at real route/terminal vertices, including T-junctions in preloaded copper.
  for (const [a, b] of segments) {
    const onSegment = vertices
      .map((point, index) => ({ point, index }))
      .filter(
        ({ point }) =>
          point.layer === a.layer && pointToSegmentDistance(point, a, b) < 1e-6,
      )
      .sort(
        (left, right) =>
          Math.hypot(left.point.x - a.x, left.point.y - a.y) -
          Math.hypot(right.point.x - a.x, right.point.y - a.y),
      )
    for (let index = 1; index < onSegment.length; index++) {
      const from = onSegment[index - 1]!
      const to = onSegment[index]!
      addEdge(
        from.index,
        to.index,
        Math.hypot(from.point.x - to.point.x, from.point.y - to.point.y),
        0,
      )
    }
  }
  const maxVias = Math.min(rule.maxViaCount ?? availableVias, availableVias)
  const startPoint = constrained[0]!
  const starts = pointVertices[points.indexOf(startPoint)]!
  const targetPoints =
    constrained.length > 1
      ? constrained.slice(1)
      : points.filter((point) => point !== startPoint)
  if (targetPoints.length === 0)
    return { length: Infinity, vias: Infinity, satisfied: false }
  const targetSets =
    constrained.length > 1
      ? targetPoints.map(
          (point) => new Set(pointVertices[points.indexOf(point)]!),
        )
      : [
          new Set(
            targetPoints.flatMap(
              (point) => pointVertices[points.indexOf(point)]!,
            ),
          ),
        ]
  const distance = new Map<string, number>()
  const queue = starts.map((vertex) => ({ vertex, vias: 0, length: 0 }))
  for (const start of queue) distance.set(`${start.vertex}:0`, 0)
  const results: RouteConstraintMeasurement[] = []
  while (queue.length > 0) {
    queue.sort((a, b) => b.length - a.length)
    const current = queue.pop()!
    if (distance.get(`${current.vertex}:${current.vias}`) !== current.length)
      continue
    for (let index = targetSets.length - 1; index >= 0; index--) {
      if (!targetSets[index]!.has(current.vertex)) continue
      results.push({
        length: current.length,
        vias: current.vias,
        satisfied: current.length <= (rule.maxLength ?? Infinity) + 1e-6,
      })
      targetSets.splice(index, 1)
    }
    if (targetSets.length === 0) break
    for (const edge of adjacency[current.vertex]!) {
      const vias = current.vias + edge.vias
      if (vias > maxVias) continue
      const length = current.length + edge.length
      const key = `${edge.to}:${vias}`
      if (length >= (distance.get(key) ?? Infinity)) continue
      distance.set(key, length)
      queue.push({ vertex: edge.to, vias, length })
    }
  }
  if (targetSets.length > 0)
    return { length: Infinity, vias: Infinity, satisfied: false }
  return {
    length: Math.max(...results.map((result) => result.length)),
    vias: Math.max(...results.map((result) => result.vias)),
    satisfied: results.every((result) => result.satisfied),
  }
}

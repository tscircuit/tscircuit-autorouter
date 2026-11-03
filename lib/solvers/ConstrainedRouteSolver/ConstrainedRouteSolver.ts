import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { ConnectionPoint, SimpleRouteConstraint, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"
import { BaseSolver } from "../BaseSolver"
import { measureRouteConstraint } from "./measureRouteConstraint"

type Point = { x: number; y: number }
type Rect = { minX: number; maxX: number; minY: number; maxY: number }
type CopperSegment = { a: Point; b: Point; radius: number }
type CandidatePath = { points: Point[]; layer: string; length: number; target: ConnectionPoint }

/** True only when the segment enters the open expanded obstacle rectangle. */
function crossesRect(a: Point, b: Point, rect: Rect): boolean {
  let near = 0
  let far = 1
  for (const [origin, direction, minimum, maximum] of [
    [a.x, b.x - a.x, rect.minX + 1e-8, rect.maxX - 1e-8],
    [a.y, b.y - a.y, rect.minY + 1e-8, rect.maxY - 1e-8],
  ]) {
    if (Math.abs(direction!) < 1e-12) {
      if (origin! <= minimum! || origin! >= maximum!) return false
      continue
    }
    const from = (minimum! - origin!) / direction!
    const to = (maximum! - origin!) / direction!
    near = Math.max(near, Math.min(from, to))
    far = Math.min(far, Math.max(from, to))
    if (near > far) return false
  }
  return far >= 0 && near <= 1
}

/** Reserve zero-via paths before unconstrained routing consumes their corridors. */
export class ConstrainedRouteSolver extends BaseSolver {
  outputSrj: SimpleRouteJson
  newTraceIds = new Set<string>()
  private pending: SimpleRouteConstraint[]

  constructor(public readonly inputSrj: SimpleRouteJson) {
    super()
    this.outputSrj = { ...inputSrj, traces: [...(inputSrj.traces ?? [])] }
    this.pending = [...(inputSrj.routeConstraints ?? [])]
    if (this.pending.length === 0) this.outputSrj = inputSrj
    this.MAX_ITERATIONS = this.pending.length + 1
    for (const rule of this.pending) {
      if (rule.maxViaCount !== undefined && (!Number.isInteger(rule.maxViaCount) || rule.maxViaCount < 0)) throw new Error("Maximum via count must be a nonnegative integer")
      if (rule.maxLength !== undefined && (!Number.isFinite(rule.maxLength) || rule.maxLength < 0)) throw new Error("Maximum route length must be finite and nonnegative")
    }
  }

  override _step(): void {
    const rule = this.pending.shift()
    if (!rule) {
      this.solved = true
      return
    }
    if (rule.maxViaCount !== 0) return
    const existing = measureRouteConstraint(this.outputSrj, this.outputSrj.traces!, rule)
    if (existing.satisfied) return
    const connection = this.inputSrj.connections.find((candidate) => candidate.name === rule.connectionName)
    if (!connection) throw new Error("Route constraint references a missing connection")
    const terminals = rule.pointIds.map((pointId) => {
      const terminal = connection.pointsToConnect.find((point) => point.pointId === pointId || point.pcb_port_id === pointId)
      if (!terminal) throw new Error("Route constraint references a missing terminal")
      return terminal
    })
    const start = terminals[0]!
    const targets = terminals.length > 1 ? terminals.slice(1) : connection.pointsToConnect.filter((point) => point !== start)
    const targetGroups = terminals.length > 1 ? targets.map((point) => [point]) : [targets]
    for (const targetGroup of targetGroups) {
      let best: CandidatePath | undefined
      for (const target of targetGroup) {
        for (const layer of getConnectionPointLayers(start)) {
          if (!getConnectionPointLayers(target).includes(layer)) continue
          const path = this.findPath(rule, start, target, layer)
          if (path && (!best || path.length < best.length)) best = path
        }
      }
      if (!best) {
        this.failed = true
        this.error = `Cannot route ${rule.name ?? "constrained trace"} with 0 vias${rule.maxLength === undefined ? "" : ` within ${rule.maxLength} mm`}`
        return
      }
      const width = connection.nominalTraceWidth ?? connection.width ?? this.inputSrj.minTraceWidth
      let traceId = `constrained_route_${this.newTraceIds.size}`
      while (this.outputSrj.traces!.some((trace) => trace.pcb_trace_id === traceId)) traceId += "_"
      const trace: SimplifiedPcbTrace = {
        type: "pcb_trace", pcb_trace_id: traceId, connection_name: connection.name,
        connectsTo: [connection.name, ...[start.pointId, best.target.pointId].filter((id): id is string => id !== undefined)],
        route: best.points.map((point, index) => ({
          route_type: "wire", ...point, width, layer: best!.layer,
          ...(index === 0 && start.pcb_port_id ? { start_pcb_port_id: start.pcb_port_id } : {}),
          ...(index === best!.points.length - 1 && best!.target.pcb_port_id ? { end_pcb_port_id: best!.target.pcb_port_id } : {}),
        })),
      }
      this.outputSrj.traces!.push(trace)
      this.newTraceIds.add(traceId)
    }
  }

  /** Visibility shortest path in board-world mm; fixed terminal coordinates are never moved. */
  private findPath(rule: SimpleRouteConstraint, start: ConnectionPoint, target: ConnectionPoint, layer: string): CandidatePath | undefined {
    const srj = this.outputSrj
    const connection = srj.connections.find((candidate) => candidate.name === rule.connectionName)!
    const width = connection.nominalTraceWidth ?? connection.width ?? srj.minTraceWidth
    const padMargin = (srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0.1) + width / 2 + 1e-5
    const boardMargin = (srj.minBoardEdgeClearance ?? 0) + width / 2
    const connectivity = getConnectivityMapFromSimpleRouteJson(srj)
    const net = connectivity.getNetConnectedToId(connection.name)
    const rectangles: Rect[] = addApproximatingRectsToSrj(srj).obstacles
      .filter((obstacle) => obstacle.layers.includes(layer) && !obstacle.connectedTo.some((id) => net && connectivity.getNetConnectedToId(id) === net))
      .map((obstacle) => {
        const margin = obstacle.isNonPlatedHole
          ? (srj.minTraceToHoleEdgeClearance ?? srj.minTraceToPadEdgeClearance ?? 0.1) + width / 2 + 1e-5
          : padMargin
        return { minX: obstacle.center.x - obstacle.width / 2 - margin, maxX: obstacle.center.x + obstacle.width / 2 + margin, minY: obstacle.center.y - obstacle.height / 2 - margin, maxY: obstacle.center.y + obstacle.height / 2 + margin }
      })
    const copper: CopperSegment[] = []
    for (const trace of srj.traces ?? []) {
      if (net && connectivity.getNetConnectedToId(trace.connection_name) === net) continue
      for (let index = 0; index < trace.route.length; index++) {
        const point = trace.route[index]!
        const next = trace.route[index + 1]
        if (point.route_type === "wire" && point.layer === layer && next?.route_type === "wire" && next.layer === layer) {
          copper.push({ a: point, b: next, radius: (Math.max(point.width, next.width) + width) / 2 + (srj.minTraceToPadEdgeClearance ?? 0.1) + 1e-5 })
        } else if (point.route_type === "via") {
          // Through-via barrels block every copper layer, including inner layers.
          copper.push({ a: point, b: point, radius: (point.via_diameter ?? srj.minViaPadDiameter ?? 0.6) / 2 + padMargin })
        }
      }
    }
    const validPoint = (point: Point): boolean => {
      if (point.x < srj.bounds.minX + boardMargin || point.x > srj.bounds.maxX - boardMargin || point.y < srj.bounds.minY + boardMargin || point.y > srj.bounds.maxY - boardMargin) return false
      if (Math.hypot(point.x - start.x, point.y - start.y) + Math.hypot(point.x - target.x, point.y - target.y) > (rule.maxLength ?? Infinity) + 1e-6) return false
      return !rectangles.some((rect) => point.x > rect.minX + 1e-8 && point.x < rect.maxX - 1e-8 && point.y > rect.minY + 1e-8 && point.y < rect.maxY - 1e-8)
    }
    const vertices: Point[] = [start, target]
    for (const rect of rectangles) {
      for (const x of [rect.minX, rect.maxX]) for (const y of [rect.minY, rect.maxY]) if (validPoint({ x, y })) vertices.push({ x, y })
    }
    for (const segment of copper) {
      for (const point of [segment.a, segment.b]) for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
        const corner = { x: point.x + dx * segment.radius, y: point.y + dy * segment.radius }
        if (validPoint(corner)) vertices.push(corner)
      }
    }
    if (!validPoint(start) || !validPoint(target)) return undefined
    const distance = new Array<number>(vertices.length).fill(Infinity)
    const parent = new Array<number>(vertices.length).fill(-1)
    const visited = new Set<number>()
    distance[0] = 0
    while (visited.size < vertices.length) {
      let current = -1
      let score = Infinity
      for (let index = 0; index < vertices.length; index++) {
        if (visited.has(index)) continue
        const point = vertices[index]!
        const candidate = distance[index]! + Math.hypot(target.x - point.x, target.y - point.y)
        if (candidate < score) { current = index; score = candidate }
      }
      if (current === -1 || score > (rule.maxLength ?? Infinity) + 1e-6) return undefined
      if (current === 1) {
        const path: Point[] = []
        for (let index = current; index !== -1; index = parent[index]!) path.push(vertices[index]!)
        return { points: path.reverse(), layer, length: distance[current]!, target }
      }
      visited.add(current)
      const a = vertices[current]!
      for (let index = 0; index < vertices.length; index++) {
        if (visited.has(index)) continue
        const b = vertices[index]!
        const length = distance[current]! + Math.hypot(b.x - a.x, b.y - a.y)
        if (length >= distance[index]! || length > (rule.maxLength ?? Infinity)) continue
        if (rectangles.some((rect) => crossesRect(a, b, rect))) continue
        if (copper.some((segment) => segmentToSegmentMinDistance(a, b, segment.a, segment.b) < segment.radius - 1e-8)) continue
        if (srj.outline && doesSegmentCrossPolygonBoundary({ start: a, end: b, polygon: srj.outline, margin: boardMargin })) continue
        distance[index] = length
        parent[index] = current
      }
    }
    return undefined
  }
}

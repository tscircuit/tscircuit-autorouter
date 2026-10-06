import RBush from "rbush"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { PriorityQueue } from "lib/data-structures/PriorityQueue"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { canPublishPartialFixedObstacleRepair } from "./canPublishPartialFixedObstacleRepair"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"

type Point = HighDensityRoute["route"][number]
type Segment = { a: Point; b: Point; radius: number }
type CopperGeometry =
  | { kind: "segment"; segment: Segment }
  | { kind: "circle"; point: Point; radius: number }
  | { kind: "polygon"; points: Point[] }
type IndexedCopper = CopperGeometry & {
  minX: number
  maxX: number
  minY: number
  maxY: number
}
type Params = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedRoutes: HighDensityRoute[]
  immutableConnectionNames: ReadonlySet<string>
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
  effort: number
}

/** Searches legal planar detours between existing locked terminals and vias. */
export class Pipeline9GridDrcRepairSolver extends BaseSolver {
  private output: HighDensityRoute[]
  private readonly netByConnectionName: ReadonlyMap<string, string>
  private queue: Array<{ routeIndex: number; start: number; end: number }> = []
  private initialCount: number
  private currentCount: number
  private currentErrors: Pipeline9DrcError[]
  private accepted = 0
  private searched = 0
  private expanded = 0

  constructor(public readonly params: Params) {
    super()
    this.output = params.routes
    this.netByConnectionName = getPipeline9NetByConnectionName([...params.routes, ...params.fixedRoutes], params.connMap)
    const evaluation = params.drcEvaluator({ routes: this.output, hdRoutes: this.output, traces: [] })
    const errors = Array.isArray(evaluation) ? evaluation : evaluation.errors
    this.currentErrors = errors as unknown as Pipeline9DrcError[]
    this.initialCount = this.currentCount = errors.length
    const pairedConnections = new Set(params.srj.differentialPairs?.flatMap((pair) => pair.connectionNames))
    const affectedIds = new Set(errors.flatMap((error) => getDrcErrorTraceIds(error as unknown as Record<string, unknown>)))
    if (errors.length > 0) {
      for (let routeIndex = 0; routeIndex < this.output.length; routeIndex++) {
        const route = this.output[routeIndex]!
        if (params.immutableConnectionNames.has(route.connectionName) || route.jumpers?.length) continue
        // Paired geometry needs a coupled search; independent detours could break coupling.
        if (pairedConnections.has(route.connectionName) || (route.rootConnectionName && pairedConnections.has(route.rootConnectionName))) continue
        if (![...affectedIds].some((id) => id === route.connectionName || id.startsWith(`${route.connectionName}_`))) continue
        let start = 0
        for (let end = 1; end < route.route.length; end++) {
          const before = route.route[end - 1]!
          const point = route.route[end]!
          if (before.z !== point.z || before.toNextSegmentType === "through_obstacle") {
            if (end - 1 > start) this.queue.push({ routeIndex, start, end: end - 1 })
            start = end
          } else if (
            point.pcb_port_id || point.insideJumperPad || point.toNextSegmentCircuitJsonMetadata ||
            route.vias.some((via) => via.x === point.x && via.y === point.y) ||
            end === route.route.length - 1
          ) {
            if (end > start) this.queue.push({ routeIndex, start, end })
            start = end
          }
        }
      }
    }
    // Later spans first keep accepted edits from invalidating queued point indices.
    this.queue.sort((a, b) => b.routeIndex - a.routeIndex || b.start - a.start)
    this.queue = this.queue.slice(0, Math.min(24, Math.max(0, Math.ceil(params.effort * 8))))
    this.MAX_ITERATIONS = this.queue.length + 2
    this.updateStats()
  }

  private connected(left: string, right: string): boolean {
    const leftNet = this.netByConnectionName.get(left)
    const rightNet = this.netByConnectionName.get(right)
    if (left === right || (leftNet !== undefined && leftNet === rightNet)) return true
    return this.params.connMap.areIdsConnected(leftNet ?? left, rightNet ?? right)
  }

  private detour(routeIndex: number, start: number, end: number): Point[] | null {
    const owner = this.output[routeIndex]!
    const original = owner.route.slice(start, end + 1)
    const a = original[0]!, b = original[original.length - 1]!
    const width = a.traceThickness ?? owner.traceThickness
    if (original.some((point) => (point.traceThickness ?? owner.traceThickness) !== width)) return null
    const radius = width / 2
    const clearance = Math.max(0.1, this.params.srj.minTraceToPadEdgeClearance ?? 0.1)
    const margin = Math.max(1.5, owner.viaDiameter * 2, Math.hypot(a.x - b.x, a.y - b.y) * 0.25)
    const bounds = this.params.srj.bounds
    const edge = this.params.srj.minBoardEdgeClearance ?? 0
    const minX = Math.max(bounds.minX + edge + radius, Math.min(...original.map((p) => p.x)) - margin)
    const maxX = Math.min(bounds.maxX - edge - radius, Math.max(...original.map((p) => p.x)) + margin)
    const minY = Math.max(bounds.minY + edge + radius, Math.min(...original.map((p) => p.y)) - margin)
    const maxY = Math.min(bounds.maxY - edge - radius, Math.max(...original.map((p) => p.y)) + margin)
    if (minX >= maxX || minY >= maxY) return null
    const h = Math.max(0.05, Math.min(0.2, width / 2))
    const nx = Math.ceil((maxX - minX) / h) + 1, ny = Math.ceil((maxY - minY) / h) + 1
    if (nx * ny > 60_000) return null
    const segments: Segment[] = []
    const circles: Array<{ point: Point; radius: number }> = []
    for (const route of [...this.output, ...this.params.fixedRoutes]) {
      if (this.connected(owner.connectionName, route.connectionName)) continue
      for (let i = 1; i < route.route.length; i++) {
        const from = route.route[i - 1]!, to = route.route[i]!
        if (from.z === a.z && to.z === a.z && from.toNextSegmentType !== "through_obstacle") {
          segments.push({ a: from, b: to, radius: Math.max(from.traceThickness ?? route.traceThickness, to.traceThickness ?? route.traceThickness) / 2 })
        }
      }
      // Physical through-via copper is present on every board layer.
      for (const via of route.vias) circles.push({ point: { ...via, z: a.z }, radius: route.viaDiameter / 2 })
    }
    const polygons: Point[][] = []
    for (const obstacle of this.params.srj.obstacles) {
      if (!obstacle.layers.some((layer) => mapLayerNameToZ(layer, this.params.srj.layerCount) === a.z)) continue
      if (obstacle.connectedTo.some((id) => this.connected(owner.connectionName, id))) continue
      if (obstacle.shape === "circle") {
        circles.push({ point: { ...obstacle.center, z: a.z }, radius: Math.max(obstacle.width, obstacle.height) / 2 })
      } else {
        const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const cos = Math.cos(angle), sin = Math.sin(angle)
        polygons.push([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
          const x = sx! * obstacle.width / 2, y = sy! * obstacle.height / 2
          return { x: obstacle.center.x + x * cos - y * sin, y: obstacle.center.y + x * sin + y * cos, z: a.z }
        }))
      }
    }
    const inside = (point: Point, polygon: Array<{ x: number; y: number }>): boolean => {
      let result = false
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const p = polygon[i]!, q = polygon[j]!
        if ((p.y > point.y) !== (q.y > point.y) && point.x < (q.x - p.x) * (point.y - p.y) / (q.y - p.y) + p.x) result = !result
      }
      return result
    }
    // Index physical copper once per search, so each A* edge only tests nearby copper.
    const copper = new RBush<IndexedCopper>()
    const indexed: IndexedCopper[] = []
    for (const segment of segments) indexed.push({
      kind: "segment", segment,
      minX: Math.min(segment.a.x, segment.b.x) - segment.radius,
      maxX: Math.max(segment.a.x, segment.b.x) + segment.radius,
      minY: Math.min(segment.a.y, segment.b.y) - segment.radius,
      maxY: Math.max(segment.a.y, segment.b.y) + segment.radius,
    })
    for (const circle of circles) indexed.push({
      kind: "circle", ...circle,
      minX: circle.point.x - circle.radius, maxX: circle.point.x + circle.radius,
      minY: circle.point.y - circle.radius, maxY: circle.point.y + circle.radius,
    })
    for (const points of polygons) indexed.push({
      kind: "polygon", points,
      minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)),
    })
    copper.load(indexed)
    const legal = (from: Point, to: Point): boolean => {
      if (Math.min(from.x, to.x) < minX || Math.max(from.x, to.x) > maxX || Math.min(from.y, to.y) < minY || Math.max(from.y, to.y) > maxY) return false
      const required = radius + clearance + 0.005
      const nearby = copper.search({
        minX: Math.min(from.x, to.x) - required, maxX: Math.max(from.x, to.x) + required,
        minY: Math.min(from.y, to.y) - required, maxY: Math.max(from.y, to.y) + required,
      })
      for (const item of nearby) {
        if (item.kind === "segment") {
          if (minimumDistanceBetweenSegments(from, to, item.segment.a, item.segment.b) < required + item.segment.radius) return false
        } else if (item.kind === "circle") {
          if (minimumDistanceBetweenSegments(from, to, item.point, item.point) < required + item.radius) return false
        } else {
          const polygon = item.points
          if (inside(from, polygon) || inside(to, polygon)) return false
          for (let i = 0; i < polygon.length; i++) if (minimumDistanceBetweenSegments(from, to, polygon[i]!, polygon[(i + 1) % polygon.length]!) < required) return false
        }
      }
      const outline = this.params.srj.outline
      if (outline?.length) {
        if (!inside(from, outline) || !inside(to, outline)) return false
        for (let i = 0; i < outline.length; i++) if (minimumDistanceBetweenSegments(from, to, outline[i]!, outline[(i + 1) % outline.length]!) < radius + edge) return false
      }
      return true
    }
    if (original.slice(1).every((point, i) => legal(original[i]!, point))) return null
    const point = (id: number): Point => ({ x: minX + (id % nx) * h, y: minY + Math.floor(id / nx) * h, z: a.z, traceThickness: width })
    const costs = new Float64Array(nx * ny); costs.fill(Infinity)
    const previous = new Int32Array(nx * ny); previous.fill(-2)
    const heap = new PriorityQueue<{ id: number; g: number; f: number }>([], 100_000)
    const ax = Math.round((a.x - minX) / h), ay = Math.round((a.y - minY) / h)
    for (let y = ay - 1; y <= ay + 1; y++) for (let x = ax - 1; x <= ax + 1; x++) {
      if (x < 0 || y < 0 || x >= nx || y >= ny) continue
      const id = y * nx + x, p = point(id)
      if (!legal(a, p)) continue
      const g = Math.hypot(a.x - p.x, a.y - p.y)
      costs[id] = g; previous[id] = -1; heap.enqueue({ id, g, f: g + Math.hypot(b.x - p.x, b.y - p.y) })
    }
    let target = -1, count = 0
    while (!heap.isEmpty() && count++ < 20_000) {
      const current = heap.dequeue()!
      if (current.g !== costs[current.id]) continue
      this.expanded++
      const p = point(current.id)
      if (Math.hypot(p.x - b.x, p.y - b.y) <= h * 1.5 && legal(p, b)) { target = current.id; break }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const x = current.id % nx + dx, y = Math.floor(current.id / nx) + dy
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue
        const id = y * nx + x, next = point(id), g = current.g + Math.hypot(dx, dy) * h
        if (g >= costs[id]! || !legal(p, next)) continue
        costs[id] = g; previous[id] = current.id; heap.enqueue({ id, g, f: g + Math.hypot(b.x - next.x, b.y - next.y) })
      }
    }
    if (target < 0) return null
    const result: Point[] = []
    for (let id = target; id >= 0; id = previous[id]!) result.push(point(id))
    result.reverse(); result.unshift(a); result.push(b)
    // Only remove a point when the resulting continuous segment is physically legal.
    for (let i = result.length - 2; i > 0; i--) if (legal(result[i - 1]!, result[i + 1]!)) result.splice(i, 1)
    return result
  }

  override _step(): void {
    const task = this.queue.shift()
    if (!task || this.currentCount === 0) { this.updateStats(); this.solved = true; return }
    const replacement = this.detour(task.routeIndex, task.start, task.end)
    this.searched++
    if (replacement) {
      const route = this.output[task.routeIndex]!
      const candidate = this.output.map((value, index) => index === task.routeIndex ? { ...value, route: [...route.route.slice(0, task.start), ...replacement, ...route.route.slice(task.end + 1)] } : value)
      const evaluation = this.params.drcEvaluator({ routes: candidate, hdRoutes: candidate, traces: [] })
      const remainingErrors = (Array.isArray(evaluation) ? evaluation : evaluation.errors) as unknown as Pipeline9DrcError[]
      const count = remainingErrors.length
      // A partial repair may only leave unchanged fixed-pad faults. In particular,
      // a lower total error count cannot hide a new disconnected branch or short.
      if (count < this.currentCount && (count === 0 || canPublishPartialFixedObstacleRepair({
        originalSrj: this.params.srj, initialErrors: this.currentErrors, remainingErrors,
      }))) {
        this.output = candidate
        this.currentErrors = remainingErrors
        this.currentCount = count
        this.accepted++
      }
    }
    this.updateStats()
  }

  private updateStats(): void {
    this.stats = { gridRepairInitialDrcIssueCount: this.initialCount, gridRepairFinalDrcIssueCount: this.currentCount, gridRepairCandidateCount: this.searched, gridRepairAcceptedCount: this.accepted, gridRepairExpandedNodes: this.expanded }
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Pipeline9 grid repair output requested before completion")
    return this.output
  }
}

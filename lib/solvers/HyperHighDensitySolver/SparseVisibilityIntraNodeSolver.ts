import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getObstacleRouteConnectivity } from "./getObstacleRouteConnectivity"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityIntraNodeRoute, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { IntraNodeRouteSolver } from "../HighDensitySolver/IntraNodeSolver"

type Point = { x: number; y: number }
type LayerPoint = Point & { z: number }
type Task = { a: PortPoint; b: PortPoint; connectionName: string; rootConnectionName?: string }
type SceneShape = {
  a: Point
  b: Point
  radius: number
  layers: number[]
  polygon?: Point[]
  owners: string[]
  kind: "terminal" | "trace" | "via" | "obstacle"
  cachedBounds?: { minX: number; maxX: number; minY: number; maxY: number }
}
type HeapEntry = { state: number; cost: number; priority: number }
type Params = ConstructorParameters<typeof IntraNodeRouteSolver>[0] & {
  boardGeometry?: HighDensityBoardGeometry
  maxGeometryTests?: number
  maxEvents?: number
  maxRefinements?: number
  orderingCount?: number
}

const EPS = 1e-7

/**
 * A bounded geometric catalog, not a complete router or an infeasibility proof.
 * Visibility edges span free space directly. Only blockers encountered by search
 * create boundary events; no uniform grid is allocated. Dynamic copper remains
 * exact capsules and through-vias are checked on every board layer.
 */
export class SparseVisibilityIntraNodeSolver extends IntraNodeRouteSolver {
  readonly sparseDiagnostics = {
    geometryTests: 0,
    broadphaseTests: 0,
    edgesChecked: 0,
    expandedStates: 0,
    refinements: 0,
    events: 0,
    ordersAttempted: 0,
    solvedTasks: 0,
    outcome: "SEARCHING" as "SEARCHING" | "SOLVED" | "UNKNOWN",
  }
  readonly maxGeometryTests: number
  readonly maxEvents: number
  readonly maxRefinements: number
  readonly orderingCount: number
  private readonly boardLayerCount: number
  private readonly layers: number[]
  private readonly staticScene: SceneShape[] = []
  private readonly nearbyObstacles: Obstacle[] = []
  private readonly allTasks: Task[] = []
  private readonly order: Task[] = []
  private readonly bounds: { minX: number; maxX: number; minY: number; maxY: number }
  private readonly holeGap: number
  private readonly holeDiameter: number
  private readonly aggregate?: Record<string, number>
  private taskIndex = 0
  private orderIndex = 0
  private currentScene: SceneShape[] = []

  constructor(private readonly validationParams: Params) {
    const params = validationParams
    super(params)
    this.aggregate = params.priorityDiagnostics
    if (this.aggregate) this.aggregate.sparseInstances = (this.aggregate.sparseInstances ?? 0) + 1
    this.boardLayerCount = params.layerCount ?? Math.max(2, ...params.nodeWithPortPoints.portPoints.map((point) => point.z + 1), ...(params.nodeWithPortPoints.availableZ ?? []).map((z) => z + 1))
    this.layers = params.nodeWithPortPoints.availableZ
      ? [...new Set(params.nodeWithPortPoints.availableZ)].sort((a, b) => a - b)
      : Array.from({ length: this.boardLayerCount }, (_, z) => z)
    this.maxGeometryTests = params.maxGeometryTests ?? 200_000
    this.maxEvents = params.maxEvents ?? 128
    this.maxRefinements = params.maxRefinements ?? 4
    this.orderingCount = params.orderingCount ?? 2
    this.holeDiameter = params.viaHoleDiameter ?? this.viaDiameter
    this.holeGap = params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
    const node = this.nodeWithPortPoints
    this.bounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }
    this.MAX_ITERATIONS = 1000
    this.stats.sparse = this.sparseDiagnostics
    if (this.layers.some((z) => !Number.isInteger(z) || z < 0 || z >= this.boardLayerCount)) {
      throw new Error("Sparse visibility received an invalid routing layer")
    }
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents < 3 || this.maxEvents > 4096 || !Number.isSafeInteger(this.maxGeometryTests) || this.maxGeometryTests < 1 || !Number.isSafeInteger(this.maxRefinements) || this.maxRefinements < 0 || this.maxRefinements > 16 || !Number.isSafeInteger(this.orderingCount) || this.orderingCount < 1 || this.orderingCount > 6) {
      throw new Error("Sparse visibility received invalid catalog budgets")
    }
    if (![this.traceWidth, this.viaDiameter, this.obstacleMargin, this.holeDiameter, this.holeGap, node.width, node.height, node.center.x, node.center.y].every(Number.isFinite) || this.traceWidth <= 0 || this.viaDiameter <= 0 || this.obstacleMargin < 0 || this.holeDiameter <= 0 || this.holeGap < 0 || node.width <= 0 || node.height <= 0) {
      throw new Error("Sparse visibility received invalid physical dimensions")
    }
    const groups = new Map<string, PortPoint[]>()
    for (const port of node.portPoints) {
      if (![port.x, port.y, port.z].every(Number.isFinite) || !Number.isInteger(port.z) || port.z < 0 || port.z >= this.boardLayerCount) throw new Error("Sparse visibility received an invalid terminal")
      const points = groups.get(port.connectionName)
      if (points) points.push(port)
      else groups.set(port.connectionName, [port])
    }
    const pairs = node.portPointsInPairs ?? [...groups.values()].flatMap(getConnectionPortPointPairs)
    for (const [a, b] of pairs) {
      if (a.connectionName !== b.connectionName) {
        throw new Error("Sparse visibility received a pair with different connection identities")
      }
      this.allTasks.push({ a, b, connectionName: a.connectionName, rootConnectionName: a.rootConnectionName ?? b.rootConnectionName })
    }
    if ((params.priorityCoordinateScale ?? 1) !== 1) {
      this.finishUnknown("requires a physical-scale scene; virtual growth is outside this experiment")
      return
    }
    if (this.allTasks.length < 2 || this.allTasks.length > 32 || this.layers.length === 0) {
      this.finishUnknown("outside the 2–32 task sparse catalog scope")
      return
    }
    // Native routing already has guarded endpoint/nearby-via handling for
    // exact-XY layer changes. A generic center portal must not steal that case.
    if (this.allTasks.some(({ a, b }) => a.x === b.x && a.y === b.y && a.z !== b.z)) {
      this.finishUnknown("native exact-XY layer-transition fast path has priority")
      return
    }
    for (const obstacle of params.obstacles ?? []) this.addStaticObstacle(obstacle)
    for (const port of node.portPoints) {
      this.staticScene.push({ a: port, b: port, radius: this.traceWidth / 2, layers: [port.z], owners: [port.connectionName, port.rootConnectionName ?? port.connectionName], kind: "terminal" })
    }
    this.beginOrder()
  }

  override getSolverName(): string {
    return "SparseVisibilityIntraNodeSolver"
  }

  private sameOwner(shape: SceneShape, task: Task): boolean {
    const names = [task.connectionName, task.rootConnectionName ?? task.connectionName]
    for (const owner of shape.owners) {
      for (const name of names) {
        if (owner === name || this.connMap?.areIdsConnected(owner, name)) return true
      }
    }
    return false
  }

  private addStaticObstacle(obstacle: Obstacle): void {
    const radius = Math.hypot(obstacle.width, obstacle.height) / 2 + this.viaDiameter + this.obstacleMargin
    if (obstacle.center.x + radius < this.bounds.minX || obstacle.center.x - radius > this.bounds.maxX || obstacle.center.y + radius < this.bounds.minY || obstacle.center.y - radius > this.bounds.maxY) return
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const c = Math.cos(angle), s = Math.sin(angle)
    const polygon = [
      [-obstacle.width / 2, -obstacle.height / 2],
      [obstacle.width / 2, -obstacle.height / 2],
      [obstacle.width / 2, obstacle.height / 2],
      [-obstacle.width / 2, obstacle.height / 2],
    ].map(([x, y]) => ({ x: obstacle.center.x + x! * c - y! * s, y: obstacle.center.y + x! * s + y! * c }))
    this.nearbyObstacles.push(obstacle)
    const layers = obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.map((name) => mapLayerNameToZ(name, this.boardLayerCount))
    this.staticScene.push({
      a: obstacle.center, b: obstacle.center,
      radius: obstacle.shape === "circle" ? Math.max(obstacle.width, obstacle.height) / 2 : 0,
      layers, polygon: obstacle.shape === "circle" ? undefined : polygon,
      owners: obstacle.connectedTo,
      kind: "obstacle",
    })
  }

  private beginOrder(): void {
    this.order.length = 0
    const sign = this.orderIndex === 0 ? 1 : -1
    this.order.push(...this.allTasks.map((task, index) => ({ task, index })).sort((left, right) => {
      const score = (task: Task): number => Math.hypot(task.a.x - task.b.x, task.a.y - task.b.y) + (task.a.z !== task.b.z ? this.viaDiameter : 0)
      return sign * (score(right.task) - score(left.task)) || left.index - right.index
    }).map(({ task }) => task))
    this.taskIndex = 0
    this.solvedRoutes = []
    this.currentScene = [...this.staticScene]
    this.sparseDiagnostics.ordersAttempted++
    if (this.aggregate) this.aggregate.sparseOrdersAttempted = (this.aggregate.sparseOrdersAttempted ?? 0) + 1
  }

  private finishUnknown(reason: string): void {
    this.failed = true
    this.error = `Sparse visibility UNKNOWN: ${reason}`
    this.sparseDiagnostics.outcome = "UNKNOWN"
    if (this.aggregate) this.aggregate.sparseUnknown = (this.aggregate.sparseUnknown ?? 0) + 1
    this.stats.sparse = this.sparseDiagnostics
  }

  private isInterior(point: Point, radius: number): boolean {
    return point.x >= this.bounds.minX + radius - EPS && point.x <= this.bounds.maxX - radius + EPS && point.y >= this.bounds.minY + radius - EPS && point.y <= this.bounds.maxY - radius + EPS
  }

  private shapeDistance(a: Point, b: Point, shape: SceneShape): number {
    if (!shape.polygon) return minimumDistanceBetweenSegments(a, b, shape.a, shape.b) - shape.radius
    const vertices = shape.polygon
    let insideA = true, insideB = true, minimum = Infinity
    for (let index = 0; index < vertices.length; index++) {
      const p = vertices[index]!, q = vertices[(index + 1) % vertices.length]!
      insideA &&= (q.x - p.x) * (a.y - p.y) - (q.y - p.y) * (a.x - p.x) >= -EPS
      insideB &&= (q.x - p.x) * (b.y - p.y) - (q.y - p.y) * (b.x - p.x) >= -EPS
      minimum = Math.min(minimum, minimumDistanceBetweenSegments(a, b, p, q))
    }
    return insideA || insideB ? 0 : minimum
  }

  private findBlocker(a: LayerPoint, b: LayerPoint, sameOwnerByShape: Uint8Array): number {
    this.sparseDiagnostics.edgesChecked++
    const via = a.z !== b.z
    if (via && (!this.isInterior(a, this.viaDiameter / 2 + this.obstacleMargin) || a.x !== b.x || a.y !== b.y)) return -2
    for (let index = 0; index < this.currentScene.length; index++) {
      const shape = this.currentScene[index]!
      if (!via && !shape.layers.includes(a.z)) continue
      // Vias are conservatively through-board even when blind vias are allowed.
      // Avoid via-in-pad as well as unrelated copper; planar own-net copper can join.
      const sameOwner = sameOwnerByShape[index] === 1
      if (sameOwner && (!via || (shape.kind !== "obstacle" && shape.kind !== "via"))) continue
      if (sameOwner && via && shape.kind === "via" && Math.hypot(a.x - shape.a.x, a.y - shape.a.y) < EPS) continue
      if (++this.sparseDiagnostics.broadphaseTests > this.maxGeometryTests * 10) return -3
      let clearance = (via ? this.viaDiameter : this.traceWidth) / 2 + this.obstacleMargin
      if (via && shape.kind === "via") clearance = Math.max(clearance, this.holeDiameter + this.holeGap - shape.radius)
      if (sameOwner && via && shape.kind === "via") clearance = this.holeDiameter + this.holeGap - shape.radius
      let bounds = shape.cachedBounds
      if (!bounds) {
        const vertices = shape.polygon ?? [shape.a, shape.b]
        bounds = shape.cachedBounds = {
          minX: Math.min(...vertices.map((point) => point.x)) - shape.radius,
          maxX: Math.max(...vertices.map((point) => point.x)) + shape.radius,
          minY: Math.min(...vertices.map((point) => point.y)) - shape.radius,
          maxY: Math.max(...vertices.map((point) => point.y)) + shape.radius,
        }
      }
      if (Math.max(a.x, b.x) + clearance < bounds.minX || Math.min(a.x, b.x) - clearance > bounds.maxX || Math.max(a.y, b.y) + clearance < bounds.minY || Math.min(a.y, b.y) - clearance > bounds.maxY) continue
      if (++this.sparseDiagnostics.geometryTests > this.maxGeometryTests) return -3
      if (this.shapeDistance(a, b, shape) < clearance - EPS) return index
    }
    return -1
  }

  private addEvents(shape: SceneShape, points: Point[], seen: Set<string>, detail: number): void {
    const padding = (detail === 0 ? Math.max(this.traceWidth, this.viaDiameter) : this.traceWidth) / 2 + this.obstacleMargin + EPS * 4
    const directions = detail < 2 ? 8 : 16
    const vertices = shape.polygon ?? [shape.a, shape.b]
    // Circumscribed octagons remain outside rounded capsule ends. Exact edge
    // checks still decide every segment; the polygon is a search proposal only.
    const radius = (shape.radius + padding) / Math.cos(Math.PI / directions)
    for (const vertex of vertices) {
      for (let direction = 0; direction < directions; direction++) {
        const angle = direction * Math.PI * 2 / directions
        const point = { x: vertex.x + radius * Math.cos(angle), y: vertex.y + radius * Math.sin(angle) }
        const key = `${point.x.toFixed(8)},${point.y.toFixed(8)}`
        if (!seen.has(key) && this.isInterior(point, this.traceWidth / 2) && points.length < this.maxEvents) {
          points.push(point)
          seen.add(key)
        }
      }
    }
  }

  private pushHeap(heap: HeapEntry[], entry: HeapEntry): void {
    heap.push(entry)
    let index = heap.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      const previous = heap[parent]!
      if (previous.priority <= entry.priority) break
      heap[index] = previous
      index = parent
    }
    heap[index] = entry
  }

  private popHeap(heap: HeapEntry[]): HeapEntry {
    const result = heap[0]!, last = heap.pop()!
    if (heap.length === 0) return result
    let index = 0
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1
      if (child + 1 < heap.length && heap[child + 1]!.priority < heap[child]!.priority) child++
      if (heap[child]!.priority >= last.priority) break
      heap[index] = heap[child]!
      index = child
    }
    heap[index] = last
    return result
  }

  private findPath(task: Task): LayerPoint[] | null {
    const sameOwnerByShape = Uint8Array.from(this.currentScene, (shape) => Number(this.sameOwner(shape, task)))
    const startLayer = this.layers.indexOf(task.a.z), endLayer = this.layers.indexOf(task.b.z)
    if (startLayer < 0 || endLayer < 0) return null
    const points: Point[] = [task.a, task.b, this.nodeWithPortPoints.center]
    const seen = new Set(points.map((point) => `${point.x.toFixed(8)},${point.y.toFixed(8)}`))
    const incorporated = new Map<number, number>()
    const layerCount = this.layers.length
    const viaCost = this.viaDiameter * 2 + (this.nodeWithPortPoints.width + this.nodeWithPortPoints.height) * 0.2
    const cache = new Map<number, number>()
    const stateStride = this.maxEvents * layerCount
    const start = startLayer, goal = layerCount + endLayer
    for (let refinement = 0; refinement <= this.maxRefinements; refinement++) {
      const stateCount = points.length * layerCount
      const cost = new Float64Array(stateCount).fill(Infinity)
      const previous = new Int32Array(stateCount).fill(-1)
      const closed = new Uint8Array(stateCount)
      const heap: HeapEntry[] = []
      const encountered = new Set<number>()
      cost[start] = 0
      this.pushHeap(heap, { state: start, cost: 0, priority: Math.hypot(task.a.x - task.b.x, task.a.y - task.b.y) + (startLayer === endLayer ? 0 : viaCost) })
      while (heap.length > 0) {
        const current = this.popHeap(heap)
        if (closed[current.state] || current.cost !== cost[current.state]) continue
        if (current.state === goal) {
          const result: LayerPoint[] = []
          for (let state = goal; state !== -1; state = previous[state]!) {
            const point = points[Math.floor(state / layerCount)]!
            result.push({ x: point.x, y: point.y, z: this.layers[state % layerCount]! })
          }
          return result.reverse()
        }
        closed[current.state] = 1
        this.sparseDiagnostics.expandedStates++
        const xyIndex = Math.floor(current.state / layerCount), layerIndex = current.state % layerCount
        const pointA = points[xyIndex]!
        const a = { x: pointA.x, y: pointA.y, z: this.layers[layerIndex]! }
        for (let next = 0; next < stateCount; next++) {
          if (closed[next] || next === current.state) continue
          const nextXY = Math.floor(next / layerCount), nextLayer = next % layerCount
          if (nextLayer !== layerIndex && nextXY !== xyIndex) continue
          const pointB = points[nextXY]!
          const b = { x: pointB.x, y: pointB.y, z: this.layers[nextLayer]! }
          const distance = nextLayer === layerIndex ? Math.hypot(a.x - b.x, a.y - b.y) : viaCost
          const tentative = current.cost + distance
          if (tentative >= cost[next]!) continue
          const left = Math.min(current.state, next), right = Math.max(current.state, next)
          const key = left * stateStride + right
          let blocker = cache.get(key)
          if (blocker === undefined) {
            blocker = this.findBlocker(a, b, sameOwnerByShape)
            cache.set(key, blocker)
          }
          if (blocker === -3) return null
          if (blocker >= 0) encountered.add(blocker)
          if (blocker !== -1) continue
          cost[next] = tentative
          previous[next] = current.state
          const estimate = Math.hypot(b.x - task.b.x, b.y - task.b.y) + (nextLayer === endLayer ? 0 : viaCost)
          this.pushHeap(heap, { state: next, cost: tentative, priority: tentative + estimate })
        }
      }
      if (refinement === this.maxRefinements || points.length >= this.maxEvents) return null
      const initialCount = points.length
      for (const blocker of encountered) {
        const detail = incorporated.get(blocker) ?? 0
        if (detail >= 3) continue
        incorporated.set(blocker, detail + 1)
        this.addEvents(this.currentScene[blocker]!, points, seen, detail)
      }
      this.sparseDiagnostics.refinements++
      this.sparseDiagnostics.events += points.length - initialCount
      if (points.length === initialCount) return null
    }
    return null
  }

  private acceptPath(task: Task, path: LayerPoint[]): void {
    const route: HighDensityIntraNodeRoute = {
      connectionName: task.connectionName,
      rootConnectionName: task.rootConnectionName,
      regionId: this.nodeWithPortPoints.capacityMeshNodeId,
      traceThickness: this.traceWidth,
      viaDiameter: this.viaDiameter,
      // Route-level terminal tags belong to HighDensitySolver's explicit
      // preservation policy. Copying port objects here also leaks their IDs
      // into interior layer states, so output geometry is built from XYZ only.
      route: path.map((point, index) => {
        const terminalId = index === 0 ? task.a.pcb_port_id : index === path.length - 1 ? task.b.pcb_port_id : undefined
        return { x: point.x, y: point.y, z: point.z, ...(terminalId === undefined ? {} : { pcb_port_id: terminalId }) }
      }),
      vias: [],
    }
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]!, b = path[index]!
      if (a.z !== b.z) {
        route.vias.push({ x: a.x, y: a.y })
        this.currentScene.push({ a, b: a, radius: this.viaDiameter / 2, layers: Array.from({ length: this.boardLayerCount }, (_, z) => z), owners: [task.connectionName, task.rootConnectionName ?? task.connectionName], kind: "via" })
      } else {
        this.currentScene.push({ a, b, radius: this.traceWidth / 2, layers: [a.z], owners: [task.connectionName, task.rootConnectionName ?? task.connectionName], kind: "trace" })
      }
    }
    this.solvedRoutes.push(route)
    this.sparseDiagnostics.solvedTasks++
  }

  private validatePhysicalBoard(): boolean {
    const routes = this.solvedRoutes
    const obstacles = this.nearbyObstacles
    const { connectedRouteNamesByObstacle, connectedObstaclesByRoute } = getObstacleRouteConnectivity({ obstacles, routes, connMap: this.connMap })
    const srj: SimpleRouteJson = {
      layerCount: this.boardLayerCount,
      minTraceWidth: this.traceWidth,
      minViaDiameter: this.viaDiameter,
      minViaHoleDiameter: this.holeDiameter,
      bounds: this.bounds,
      ...this.validationParams.boardGeometry,
      obstacles: obstacles.map((obstacle, index) => ({ ...obstacle, connectedTo: [...obstacle.connectedTo, ...connectedRouteNamesByObstacle[index]!] })),
      connections: routes.map((route, index) => ({
        name: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        __netConnectionName: route.rootConnectionName ?? route.connectionName,
        pointsToConnect: [
          ...[route.route[0]!, route.route.at(-1)!].map((point) => ({ x: point.x, y: point.y, layer: mapZToLayerName(point.z, this.boardLayerCount) })),
          ...connectedObstaclesByRoute[index]!.flatMap((obstacle) => {
            const pcbPortId = obstacle.circuitJsonMetadata?.pcb_port_id
            return pcbPortId ? [{ ...obstacle.center, layer: "top", pcb_port_id: pcbPortId }] : []
          }),
        ],
      })),
    }
    const traces = routes.map((route, index) => ({ type: "pcb_trace" as const, pcb_trace_id: `sparse_${index}`, connection_name: route.connectionName, route: convertHdRouteToSimplifiedRoute(route, this.boardLayerCount) }))
    const circuitJson = convertToCircuitJson(srj, traces)
    if (this.validationParams.boardGeometry) circuitJson.push(createPcbBoardElement(srj))
    const { errors } = getDrcErrors(circuitJson, { traceClearance: this.obstacleMargin, viaClearance: this.obstacleMargin, holeClearance: this.holeGap, includeTraceContinuity: false })
    const fixedViolations = getFixedObstacleViolations({ srj: { ...srj, traces: undefined }, routes })
    this.stats.boardObstaclesChecked = obstacles.length
    this.stats.boardDrcIssueCount = errors.length + fixedViolations.length
    if (this.aggregate) {
      this.aggregate.sparseBoardValidationCalls = (this.aggregate.sparseBoardValidationCalls ?? 0) + 1
      this.aggregate.sparseBoardValidationIssues = (this.aggregate.sparseBoardValidationIssues ?? 0) + errors.length + fixedViolations.length
    }
    if (errors.length > 0 || fixedViolations.length > 0) {
      this.finishUnknown(`board copper validation rejected the catalog proposal: ${errors[0]?.message ?? "fixed obstacle clearance violation"}`)
      return false
    }
    return true
  }

  override _step(): void {
    const keys = ["geometryTests", "broadphaseTests", "edgesChecked", "expandedStates", "refinements", "events", "solvedTasks"] as const
    const before = keys.map((key) => this.sparseDiagnostics[key])
    const start = performance.now()
    this.stepSparseSearch()
    if (this.aggregate) {
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!
        const name = `sparse${key[0]!.toUpperCase()}${key.slice(1)}`
        this.aggregate[name] = (this.aggregate[name] ?? 0) + this.sparseDiagnostics[key] - before[index]!
      }
      this.aggregate.sparseSearchTimeMs = (this.aggregate.sparseSearchTimeMs ?? 0) + performance.now() - start
      if (this.solved) this.aggregate.sparseWins = (this.aggregate.sparseWins ?? 0) + 1
    }
  }

  private stepSparseSearch(): void {
    if (this.solved || this.failed) return
    const task = this.order[this.taskIndex]
    if (!task) {
      // Independent route-pair geometry guards acceptance, including full-stack
      // via barrels. Catalog exhaustion is UNKNOWN; an invariant mismatch throws.
      for (let left = 0; left < this.solvedRoutes.length; left++) {
        for (let right = left + 1; right < this.solvedRoutes.length; right++) {
          const a = this.solvedRoutes[left]!, b = this.solvedRoutes[right]!
          if ((a.rootConnectionName ?? a.connectionName) === (b.rootConnectionName ?? b.connectionName) || (this.connMap && arePipeline9RoutesOnSameNet(a, b, this.connMap))) continue
          if (doPipeline9RoutesHaveCopperConflict({ left: a, right: b, clearance: Math.max(0, this.obstacleMargin - EPS * 2), layerCount: this.boardLayerCount })) {
            throw new Error("Sparse visibility exact pair validation disagrees with edge checks")
          }
        }
      }
      if (!this.validatePhysicalBoard()) return
      this.solved = true
      this.progress = 1
      this.sparseDiagnostics.outcome = "SOLVED"
      return
    }
    const path = this.findPath(task)
    let drillSpacingValid = true
    const viaLocations: Point[] = []
    if (path) {
      for (let index = 1; index < path.length; index++) {
        if (path[index - 1]!.z === path[index]!.z) continue
        const point = path[index]!
        if (viaLocations.some((previous) => Math.hypot(previous.x - point.x, previous.y - point.y) >= EPS && Math.hypot(previous.x - point.x, previous.y - point.y) < this.holeDiameter + this.holeGap - EPS)) drillSpacingValid = false
        viaLocations.push(point)
      }
    }
    if (path && drillSpacingValid) {
      this.acceptPath(task, path)
      this.taskIndex++
      this.progress = this.taskIndex / this.order.length
      return
    }
    if (this.sparseDiagnostics.geometryTests >= this.maxGeometryTests || this.sparseDiagnostics.broadphaseTests >= this.maxGeometryTests * 10) {
      this.finishUnknown("geometry work budget exhausted")
      return
    }
    if (++this.orderIndex < this.orderingCount) this.beginOrder()
    else this.finishUnknown("bounded event catalog and deterministic orderings exhausted")
  }
}

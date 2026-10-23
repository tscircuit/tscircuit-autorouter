import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { BaseSolver } from "../BaseSolver"
import { getObstacleRouteConnectivity } from "./getObstacleRouteConnectivity"
import { SharedOwnershipGraphSolver, type OwnershipGraph, type OwnershipGraphStats } from "./SharedOwnershipGraphSolver"

type Point = { x: number; y: number; z: number }
type OwnershipGraphParams = {
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap
  traceWidth?: number
  viaDiameter?: number
  obstacleMargin?: number
  obstacles?: Obstacle[]
  layerCount?: number
  effort?: number
  boardGeometry?: HighDensityBoardGeometry
  ownershipGraphStats?: OwnershipGraphStats
}

/**
 * One explicit portfolio candidate. All tasks share immutable copper primitives;
 * decisions change ownership, and exhausted searches learn reusable cut clauses.
 * Its finite graph is a candidate family, never a board infeasibility oracle.
 */
export class OwnershipGraphIntraNodeSolver extends BaseSolver {
  readonly counters: OwnershipGraphStats
  readonly primitives: HighDensityRoute[] = []
  readonly pairs: [PortPoint, PortPoint][]
  readonly traceWidth: number
  readonly viaDiameter: number
  readonly clearance: number
  readonly layerCount: number
  readonly maxConnectivityIterations: number
  readonly validationSrj: SimpleRouteJson
  engine: SharedOwnershipGraphSolver | null = null
  solvedRoutes: HighDensityRoute[] = []

  constructor(readonly params: OwnershipGraphParams) {
    super()
    this.counters = params.ownershipGraphStats ?? {}
    this.stats = this.counters
    this.traceWidth = params.traceWidth ?? 0.15
    this.viaDiameter = params.viaDiameter ?? 0.3
    this.clearance = params.obstacleMargin ?? 0.1
    this.layerCount = params.layerCount ?? 2
    const grouped = new Map<string, PortPoint[]>()
    for (const point of params.nodeWithPortPoints.portPoints) {
      const points = grouped.get(point.connectionName) ?? []
      points.push(point)
      grouped.set(point.connectionName, points)
    }
    this.pairs = params.nodeWithPortPoints.portPointsInPairs ??
      [...grouped.values()].flatMap((points) => getConnectionPortPointPairs(points))
    this.validationSrj = this.createValidationSrj()
    this.maxConnectivityIterations = Math.max(1, Math.round(40_000 * Math.max(1, this.pairs.length) * (params.effort ?? 1)))
    this.MAX_ITERATIONS = Math.ceil(this.maxConnectivityIterations / 32) + 2
    if (this.pairs.length < 2 || this.pairs.length > 12) {
      this.failed = true
      this.error = "Ownership graph candidate supports two to twelve pair tasks"
      this.counters.ownershipGraphIneligibleCount = (this.counters.ownershipGraphIneligibleCount ?? 0) + 1
    }
  }

  private createValidationSrj(): SimpleRouteJson {
    const node = this.params.nodeWithPortPoints
    const margin = this.viaDiameter / 2 + this.clearance
    const minX = node.center.x - node.width / 2 - margin
    const maxX = node.center.x + node.width / 2 + margin
    const minY = node.center.y - node.height / 2 - margin
    const maxY = node.center.y + node.height / 2 + margin
    const obstacles = (this.params.obstacles ?? []).filter((obstacle) => {
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2
      return obstacle.center.x + radius >= minX && obstacle.center.x - radius <= maxX &&
        obstacle.center.y + radius >= minY && obstacle.center.y - radius <= maxY
    })
    const routeNames = this.pairs.map(([start]) => ({
      connectionName: start.connectionName, rootConnectionName: start.rootConnectionName,
    }))
    const connectivity = getObstacleRouteConnectivity({ obstacles, routes: routeNames, connMap: this.params.connMap })
    return {
      layerCount: this.layerCount,
      minTraceWidth: this.traceWidth,
      minViaDiameter: this.viaDiameter,
      defaultObstacleMargin: this.clearance,
      bounds: {
        minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
        minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2,
      },
      ...this.params.boardGeometry,
      obstacles: obstacles.map((obstacle, index) => ({
        ...obstacle, connectedTo: [...obstacle.connectedTo, ...connectivity.connectedRouteNamesByObstacle[index]!],
      })),
      connections: this.pairs.map(([start, end], index) => ({
        name: start.connectionName,
        rootConnectionName: start.rootConnectionName,
        __netConnectionName: start.rootConnectionName ?? start.connectionName,
        pointsToConnect: [
          ...[start, end].map((point) => ({ ...point, layer: mapZToLayerName(point.z, this.layerCount) })),
          ...connectivity.connectedObstaclesByRoute[index]!.flatMap((obstacle) => {
            const pcbPortId = obstacle.circuitJsonMetadata?.pcb_port_id
            return pcbPortId ? [{ ...obstacle.center, layer: mapZToLayerName(0, this.layerCount), pcb_port_id: pcbPortId }] : []
          }),
        ],
      })),
    }
  }

  private initializeGraph(): void {
    const node = this.params.nodeWithPortPoints
    const bounds = {
      minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2,
    }
    const endpoints = this.pairs.flat()
    const layers = [...new Set(node.availableZ ?? Array.from({ length: this.layerCount }, (_, z) => z))].sort((a, b) => a - b)
    if (endpoints.some((p) => !layers.includes(p.z) || p.x < bounds.minX - 1e-8 || p.x > bounds.maxX + 1e-8 || p.y < bounds.minY - 1e-8 || p.y > bounds.maxY + 1e-8)) {
      throw new Error("Ownership graph endpoints must lie on an available layer inside their node")
    }
    const spacing = Math.max(0.25, this.viaDiameter + this.clearance)
    const nx = Math.max(2, Math.min(12, Math.ceil(node.width / spacing)))
    const ny = Math.max(2, Math.min(12, Math.ceil(node.height / spacing)))
    const xs = [...new Set([...endpoints.map((p) => p.x), ...Array.from({ length: nx + 1 }, (_, i) => bounds.minX + node.width * i / nx)])].sort((a, b) => a - b)
    const ys = [...new Set([...endpoints.map((p) => p.y), ...Array.from({ length: ny + 1 }, (_, i) => bounds.minY + node.height * i / ny)])].sort((a, b) => a - b)
    const graph: OwnershipGraph = { vertices: [], adjacency: [] }
    const indices = new Map<string, number>()
    for (const z of layers) for (const y of ys) for (const x of xs) {
      indices.set(`${x}:${y}:${z}`, graph.vertices.length)
      graph.vertices.push({ x, y, z })
      graph.adjacency.push([])
    }
    const edges = new Set<string>()
    const addEdge = (left: number, right: number, viaPrimitive?: number): void => {
      if (left === right) return
      const key = left < right ? `${left}:${right}` : `${right}:${left}`
      if (edges.has(key)) return
      edges.add(key)
      const a = graph.vertices[left]!, b = graph.vertices[right]!
      const primitive = viaPrimitive ?? this.primitives.length
      if (viaPrimitive === undefined) this.primitives.push({
        connectionName: "graph-primitive", traceThickness: this.traceWidth, viaDiameter: this.viaDiameter,
        route: [{ ...a }, { ...b }], vias: a.z === b.z ? [] : [{ x: a.x, y: a.y }],
      })
      const cost = a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : this.viaDiameter * 4 + this.clearance
      graph.adjacency[left]!.push({ to: right, primitive, cost })
      graph.adjacency[right]!.push({ to: left, primitive, cost })
    }
    for (const z of layers) for (let yi = 0; yi < ys.length; yi++) for (let xi = 0; xi < xs.length; xi++) {
      const left = indices.get(`${xs[xi]}:${ys[yi]}:${z}`)!
      if (xi + 1 < xs.length) addEdge(left, indices.get(`${xs[xi + 1]}:${ys[yi]}:${z}`)!)
      if (yi + 1 < ys.length) addEdge(left, indices.get(`${xs[xi]}:${ys[yi + 1]}:${z}`)!)
    }
    // A through via has one physical primitive, including its barrel on layers
    // that the task does not traverse. All layer-pair edges share that identity.
    const viaInset = this.viaDiameter / 2 + this.clearance
    for (const x of xs) for (const y of ys) {
      if (layers.length < 2 || x < bounds.minX + viaInset || x > bounds.maxX - viaInset || y < bounds.minY + viaInset || y > bounds.maxY - viaInset) continue
      const primitive = this.primitives.length
      this.primitives.push({
        connectionName: "graph-via", traceThickness: this.traceWidth, viaDiameter: this.viaDiameter,
        route: [{ x, y, z: layers[0]! }, { x, y, z: layers.at(-1)! }], vias: [{ x, y }],
      })
      for (let i = 0; i < layers.length; i++) for (let j = i + 1; j < layers.length; j++) {
        addEdge(indices.get(`${x}:${y}:${layers[i]}`)!, indices.get(`${x}:${y}:${layers[j]}`)!, primitive)
      }
    }
    // Exact endpoint chords keep simple diagonal solutions in this family;
    // the graph still shares these primitives with every other pair task.
    for (const [start, end] of this.pairs) for (const z of layers) {
      addEdge(indices.get(`${start.x}:${start.y}:${z}`)!, indices.get(`${end.x}:${end.y}:${z}`)!)
    }
    const tasks = this.pairs.map(([start, end]) => ({
      connectionName: start.connectionName,
      owner: this.params.connMap?.getNetConnectedToId(start.rootConnectionName ?? start.connectionName) ?? start.rootConnectionName ?? start.connectionName,
      start: indices.get(`${start.x}:${start.y}:${start.z}`)!, end: indices.get(`${end.x}:${end.y}:${end.z}`)!,
    }))
    this.engine = new SharedOwnershipGraphSolver({
      graph, tasks, maxIterations: this.maxConnectivityIterations, counters: this.counters,
      primitivesConflict: (left, right): boolean => doPipeline9RoutesHaveCopperConflict({
        left: this.primitives[left]!, right: this.primitives[right]!, clearance: this.clearance,
        layerCount: this.layerCount, allowBlindAndBuriedVias: false,
      }),
      permanentlyBlocked: (task, primitive): boolean => {
        if (this.validationSrj.obstacles.length === 0) return false
        const start = this.pairs[task]![0]
        const route = { ...this.primitives[primitive]!, connectionName: start.connectionName, rootConnectionName: start.rootConnectionName }
        // The checker is supplemental for imported pads. Unmodelled pad DRC is
        // checked on the complete result, never converted into a hard clause.
        return getFixedObstacleViolations({ srj: { ...this.validationSrj, traces: undefined }, routes: [route], traceClearance: this.clearance, viaClearance: this.clearance }).length > 0
      },
    })
    this.activeSubSolver = this.engine
    this.counters.ownershipGraphPrimitiveCount = (this.counters.ownershipGraphPrimitiveCount ?? 0) + this.primitives.length
  }

  private acceptGeometry(): void {
    const engine = this.engine!
    const routes = engine.paths.map((path, task): HighDensityRoute => {
      const [start, end] = this.pairs[task]!
      const points: Point[] = path.vertices.map((vertex) => ({ ...engine.graph.vertices[vertex]! }))
      const compact: Point[] = []
      for (const point of points) {
        while (compact.length >= 2) {
          const a = compact[compact.length - 2]!, b = compact.at(-1)!
          if (a.z !== b.z || b.z !== point.z || Math.abs((b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x)) > 1e-10) break
          compact.pop()
        }
        compact.push(point)
      }
      const vias = new Map<string, { x: number; y: number }>()
      for (let i = 1; i < compact.length; i++) if (compact[i]!.z !== compact[i - 1]!.z) {
        const point = compact[i]!
        vias.set(`${point.x}:${point.y}`, { x: point.x, y: point.y })
      }
      return {
        connectionName: start.connectionName, rootConnectionName: start.rootConnectionName,
        startPcbPortId: start.pcb_port_id, endPcbPortId: end.pcb_port_id,
        traceThickness: this.traceWidth, viaDiameter: this.viaDiameter,
        route: compact, vias: [...vias.values()],
      }
    })
    const traces = routes.map((route, index) => ({
      type: "pcb_trace" as const, pcb_trace_id: `ownership_${index}`, connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, this.layerCount),
    }))
    const circuitJson = convertToCircuitJson(this.validationSrj, traces)
    if (this.params.boardGeometry) circuitJson.push(createPcbBoardElement(this.validationSrj))
    const { errors } = getDrcErrors(circuitJson, { traceClearance: this.clearance, viaClearance: this.clearance, includeTraceContinuity: false })
    const fixed = getFixedObstacleViolations({ srj: { ...this.validationSrj, traces: undefined }, routes, traceClearance: this.clearance, viaClearance: this.clearance })
    this.counters.ownershipGraphFinalValidationCount = (this.counters.ownershipGraphFinalValidationCount ?? 0) + 1
    this.counters.ownershipGraphValidationIssueCount = (this.counters.ownershipGraphValidationIssueCount ?? 0) + errors.length + fixed.length
    if (errors.length || fixed.length) {
      this.failed = true
      this.error = `Ownership graph candidate fails board copper validation: ${errors[0]?.message ?? "fixed obstacle clearance violation"}`
      return
    }
    this.solvedRoutes = routes
    this.solved = true
    this.progress = 1
    this.counters.ownershipGraphAcceptedCount = (this.counters.ownershipGraphAcceptedCount ?? 0) + 1
  }

  override _step(): void {
    if (!this.engine) this.initializeGraph()
    // Match the portfolio's batched grid kernels without changing the finite
    // search work cap. Counters and fitness use actual engine expansions.
    for (let i = 0; i < 32 && !this.engine!.solved && !this.engine!.failed; i++) {
      this.engine!.step()
    }
    this.progress = this.engine!.progress
    if (this.engine!.failed) {
      this.failed = true
      this.error = this.engine!.error
      return
    }
    if (this.engine!.solved) this.acceptGeometry()
  }
}

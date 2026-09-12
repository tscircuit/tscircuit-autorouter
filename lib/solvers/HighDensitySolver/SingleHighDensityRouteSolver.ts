import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import * as bindings from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"
import { BaseSolver } from "../BaseSolver"
import type { HighDensityHyperParameters } from "./HighDensityHyperParameters"

export type FutureConnection = {
  connectionName: string
  rootConnectionName?: string
  regionId?: string
  points: { x: number; y: number; z: number }[]
}

type Point = { x: number; y: number; z: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type IndexedObstacleSegment = { z: number; A: Point; B: Point; minX: number; minY: number; maxX: number; maxY: number; connectedToCurrentConnection: boolean }
type IndexedObstacleVia = { x: number; y: number }
export type PlanarObstacleQuery = { segments: IndexedObstacleSegment[]; segmentIds: number[] }
type SearchIndex = { search: (minX: number, minY: number, maxX: number, maxY: number) => number[] }
export type SingleRouteOptions = {
  connectionName: string
  rootConnectionName?: string
  regionId?: string
  obstacleRoutes: HighDensityIntraNodeRoute[]
  minDistBetweenEnteringPoints: number
  bounds: Bounds
  A: Point
  B: Point
  viaDiameter?: number
  traceThickness?: number
  obstacleMargin?: number
  layerCount?: number
  availableZ?: number[]
  futureConnections?: FutureConnection[]
  hyperParameters?: Partial<HighDensityHyperParameters>
  connMap?: ConnectivityMap
  nearbySegmentClearance?: number
  captureSearchDebug?: boolean
}

class CandidateQueue {
  constructor(private readonly invoke: <T>(method: string, args?: Record<string, unknown>) => T) {}
  enqueue(node: Node): void { this.invoke("queueEnqueue", { node }) }
  dequeue(): Node | undefined { return this.invoke<Node | null>("queueDequeue") ?? undefined }
  peek(): Node | undefined { return this.invoke<Node | null>("queuePeek") ?? undefined }
  heapifyUp(): void { this.invoke("queueHeapifyUp") }
  heapifyDown(): void { this.invoke("queueHeapifyDown") }
  getTopN(n: number): Node[] { return this.invoke("queueTop", { n }) }
}

export class SingleHighDensityRouteSolver extends BaseSolver {
  protected readonly binding: bindings.SingleHighDensityRouteSolver
  readonly constructorParams: SingleRouteOptions
  obstacleRoutes: HighDensityIntraNodeRoute[]
  bounds: Bounds
  A: Point
  B: Point
  connectionName: string
  rootConnectionName?: string
  regionId?: string
  connMap?: ConnectivityMap
  futureConnections: FutureConnection[]
  hyperParameters: Partial<HighDensityHyperParameters>
  declare boundsSize: { width: number; height: number }
  declare boundsCenter: { x: number; y: number }
  declare straightLineDistance: number
  declare viaDiameter: number
  declare traceThickness: number
  declare obstacleMargin: number
  declare layerCount: number
  declare availableZ: number[]
  declare minCellSize: number
  declare cellStep: number
  declare GREEDY_MULTIPLER: number
  declare numRoutes: number
  declare VIA_PENALTY_FACTOR: number
  declare CELL_SIZE_FACTOR: number
  declare NEARBY_SEGMENT_CLEARANCE: number
  declare gridMinXIndex: number
  declare gridMinYIndex: number
  declare gridWidth: number
  declare gridHeight: number
  declare initialNodeGridOffset: { x: number; y: number }
  declare debugEnabled: boolean
  solvedPath: HighDensityIntraNodeRoute | null = null
  exploredNodes = new Set<number>()
  viasInPathByNode = new WeakMap<Node, IndexedObstacleVia[]>()
  obstacleSegments: IndexedObstacleSegment[] = []
  obstacleVias: IndexedObstacleVia[] = []
  obstacleSegmentsByLayer = new Map<number, IndexedObstacleSegment[]>()
  obstacleSegmentIndexByLayer = new Map<number, SearchIndex>()
  obstacleSegmentIndex: SearchIndex | null = null
  obstacleViaIndex: SearchIndex | null = null
  debug_exploredNodesOrdered: Array<{ key: number; x: number; y: number; z: number }> = []
  debug_nodesTooCloseToObstacle = new Set<number>()
  debug_nodePathToParentIntersectsObstacle = new Set<number>()
  readonly candidates: CandidateQueue

  constructor(opts: SingleRouteOptions, futureCost = false, existingBinding?: bindings.SingleHighDensityRouteSolver) {
    super()
    initializeAutorouterBindings()
    this.constructorParams = opts
    this.connectionName = opts.connectionName
    this.rootConnectionName = opts.rootConnectionName
    this.regionId = opts.regionId
    this.bounds = opts.bounds
    this.A = opts.A
    this.B = opts.B
    this.obstacleRoutes = opts.obstacleRoutes
    this.connMap = opts.connMap
    this.futureConnections = opts.futureConnections ?? []
    this.hyperParameters = opts.hyperParameters ?? {}
    const { connMap, ...plain } = opts
    let connectivity: { netMap: Record<string, string[]>; idToNetMap: Record<string, string> } | undefined
    if (connMap) {
      const idToNetMap: Record<string, string> = { [opts.connectionName]: opts.connectionName }
      for (const connection of [...opts.obstacleRoutes, ...this.futureConnections]) {
        if (connMap.areIdsConnected?.(opts.connectionName, connection.connectionName)) idToNetMap[connection.connectionName] = opts.connectionName
      }
      connectivity = { netMap: {}, idToNetMap }
    }
    this.binding = existingBinding ?? new bindings.SingleHighDensityRouteSolver({ ...plain, connMap: connectivity }, futureCost)
    this.candidates = new CandidateQueue(<T>(method: string, args?: Record<string, unknown>): T => this.invoke<T>(method, args))
    this.synchronize()
  }

  override getSolverName(): string { return "SingleHighDensityRouteSolver" }
  override getConstructorParams(): SingleRouteOptions { return this.constructorParams }

  protected configure(): void {
    const values: Record<string, unknown> = {}
    for (const key of ["MAX_ITERATIONS", "viaDiameter", "traceThickness", "obstacleMargin", "cellStep", "minCellSize", "GREEDY_MULTIPLER", "VIA_PENALTY_FACTOR", "CELL_SIZE_FACTOR", "NEARBY_SEGMENT_CLEARANCE", "gridMinXIndex", "gridMinYIndex", "gridWidth", "gridHeight", "progress", "FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR", "FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR", "FUTURE_CONNECTION_PROXIMITY_VD", "MISALIGNED_DIST_PENALTY_FACTOR", "VIA_PENALTY_FACTOR_2", "FUTURE_CONNECTION_VIA_TRACE_CLEARANCE", "FLIP_TRACE_ALIGNMENT_DIRECTION"]) {
      const value = (this as unknown as Record<string, unknown>)[key]
      if (value !== undefined) values[key] = typeof value === "number" && !Number.isFinite(value) ? null : value
    }
    this.binding.configure(values)
  }

  protected invoke<T>(method: string, args: Record<string, unknown> = {}): T {
    this.configure()
    return this.binding.call(method, args) as T
  }

  protected number(method: string, args: Record<string, unknown> = {}): number {
    return this.invoke<number | null>(method, args) ?? Number.NaN
  }

  private index(kind: "segments" | "vias" | "layer", layer?: number): SearchIndex {
    return { search: (minX, minY, maxX, maxY): number[] => this.invoke("search", { kind, layer, bounds: [minX, minY, maxX, maxY] }) }
  }

  protected synchronize(): void {
    const state = this.binding.snapshot()
    const { A, B, bounds, futureConnectionPoints, obstacleSegmentsByLayer, exploredNodes, debug_nodesTooCloseToObstacle, debug_nodePathToParentIntersectsObstacle, progress, ...plain } = state
    Object.assign(this, plain)
    this.progress = progress === null ? Number.NaN : progress
    this.exploredNodes = new Set(exploredNodes)
    this.debug_nodesTooCloseToObstacle = new Set(debug_nodesTooCloseToObstacle)
    this.debug_nodePathToParentIntersectsObstacle = new Set(debug_nodePathToParentIntersectsObstacle)
    this.obstacleSegmentsByLayer = new Map(obstacleSegmentsByLayer)
    for (const layer of this.obstacleSegmentsByLayer.keys()) {
      if (!this.obstacleSegmentIndexByLayer.has(layer)) this.obstacleSegmentIndexByLayer.set(layer, this.index("layer", layer))
    }
    for (const layer of this.obstacleSegmentIndexByLayer.keys()) if (!this.obstacleSegmentsByLayer.has(layer)) this.obstacleSegmentIndexByLayer.delete(layer)
    this.obstacleSegmentIndex = this.obstacleSegments.length ? this.obstacleSegmentIndex ?? this.index("segments") : null
    this.obstacleViaIndex = this.obstacleVias.length ? this.obstacleViaIndex ?? this.index("vias") : null
    if (this.solvedPath) {
      const { connectionName, rootConnectionName, regionId, ...rest } = this.solvedPath
      this.solvedPath = { connectionName, rootConnectionName, regionId, ...rest }
    }
  }

  refreshFromSolver(): void { this.synchronize() }

  handleSimpleCases(): void { this.invoke("handleSimpleCases"); this.synchronize() }
  get viaPenaltyDistance(): number { return this.number("viaPenaltyDistance") }
  isNodeTooCloseToObstacle(node: Node, margin?: number, isVia = false, query?: PlanarObstacleQuery): boolean {
    return this.invoke("isNodeTooCloseToObstacle", { node, margin, isVia, query: query ? { layer: node.z, segmentIds: query.segmentIds } : undefined })
  }
  isNodeTooCloseToEdge(node: Node, isVia = false): boolean { return this.invoke("isNodeTooCloseToEdge", { node, isVia }) }
  doesPathToParentIntersectObstacle(node: Node, query?: PlanarObstacleQuery): boolean {
    return this.invoke("doesPathToParentIntersectObstacle", { node, query: query ? { layer: node.z, segmentIds: query.segmentIds } : undefined })
  }
  getPlanarObstacleQuery(node: Node): PlanarObstacleQuery | undefined {
    const bounds = this.invoke<[number, number, number, number] | null>("queryBounds", { node })
    if (!bounds) return undefined
    const index = this.obstacleSegmentIndexByLayer.get(node.z)
    const segments = this.obstacleSegmentsByLayer.get(node.z)
    if (!index || !segments) throw new Error("Native planar query requires its layer index")
    return { segments, segmentIds: index.search(...bounds) }
  }
  buildObstacleIndexes(): void { this.invoke("buildObstacleIndexes", { routes: this.obstacleRoutes }); this.synchronize() }
  computeH(node: Node): number { return this.number("computeH", { node }) }
  computeG(node: Node): number { return this.number("computeG", { node }) }
  computeF(g: number, h: number): number { return this.number("computeF", { g, h }) }
  setNodeCosts(node: Node): void {
    const costs = this.invoke<{ g: number | null; h: number | null; f: number | null }>("setNodeCosts", { node })
    node.g = costs.g ?? Number.NaN; node.h = costs.h ?? Number.NaN; node.f = costs.f ?? Number.NaN
  }
  getNodeKey(node: Node): number { return this.number("getNodeKey", { node }) }
  getNeighbors(node: Node): Node[] {
    const neighbors = this.invoke<Node[]>("getNeighbors", { node })
    this.synchronize()
    return neighbors.map((neighbor) => ({ ...neighbor, parent: node }))
  }
  getNodePath(node: Node): Node[] {
    const path = this.invoke<Node[]>("getNodePath", { node })
    const originals: Node[] = []
    let current: Node | null = node
    for (let i = 0; i < path.length; i++) {
      if (!current) throw new Error("Native path length exceeds node ancestry")
      originals.push(current); current = current.parent
    }
    return originals
  }
  getViasInNodePath(node: Node): IndexedObstacleVia[] {
    let result = this.viasInPathByNode.get(node)
    if (!result) { result = this.invoke("getViasInNodePath", { node }); this.viasInPathByNode.set(node, result!) }
    return result!
  }
  setSolvedPath(node: Node): void { this.invoke("setSolvedPath", { node }); this.synchronize() }
  computeProgress(_currentNode?: Node, goalDist?: number, isOnLayer?: boolean): number { return this.number("computeProgress", { goalDist, isOnLayer }) }
  override _step(): void { this.invoke("step", { iterations: this.iterations }); this.synchronize() }
  override visualize(): GraphicsObject { return this.invoke("visualize") }
  dispose(): void { this.binding.free() }
}

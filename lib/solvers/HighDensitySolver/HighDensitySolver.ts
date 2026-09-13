import * as bindings from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import { PortfolioCallbackScope } from "lib/bindings/high-density/PortfolioCallbackScope"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { GraphicsObject } from "graphics-debug"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"
import { BaseSolver } from "../BaseSolver"
import {
  DEFAULT_MAX_GROWTH_ATTEMPTS,
  GrowShrinkHighDensityIntraNodeSolver,
} from "../HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "../HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { safeTransparentize } from "../colors"
import { IntraNodeRouteSolver } from "./IntraNodeSolver"
import { CachedIntraNodeRouteSolver } from "./CachedIntraNodeRouteSolver"

type HighDensityIntraNodeSolver =
  | IntraNodeRouteSolver
  | PortfolioSingleIntraNodeSolver
  | GrowShrinkHighDensityIntraNodeSolver

function reconcileObservedValue(current: unknown, incoming: unknown): unknown {
  if (Array.isArray(incoming)) {
    const result: unknown[] = Array.isArray(current) ? current : []
    incoming.forEach((value, index): void => {
      result[index] = reconcileObservedValue(result[index], value)
    })
    result.length = incoming.length
    return result
  }
  if (incoming !== null && typeof incoming === "object") {
    const result =
      current !== null && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {}
    for (const key of Object.keys(result))
      if (!Object.hasOwn(incoming, key)) delete result[key]
    for (const [key, value] of Object.entries(incoming))
      result[key] = reconcileObservedValue(result[key], value)
    return result
  }
  return incoming
}

export class HighDensitySolver extends BaseSolver {
  override getSolverName(): string {
    return "HighDensitySolver"
  }

  unsolvedNodePortPoints: NodeWithPortPoints[]
  routes: HighDensityIntraNodeRoute[]
  colorMap: Record<string, string>

  // Defaults as specified: viaDiameter of 0.3 and traceThickness of 0.15
  readonly defaultViaDiameter = 0.3
  readonly defaultTraceThickness = 0.15
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
  obstacles: Obstacle[]
  layerCount: number
  enableNegotiatedSearch: boolean
  boardGeometry?: HighDensityBoardGeometry
  useGrowShrinkHighDensityIntraNodeSolver: boolean
  preserveTerminalPcbPortIds: boolean
  growShrinkMaxInnerIterationsPerGrowthAttempt?: number
  growShrinkFallbackToInvalidGeometryOnFailure: boolean
  growShrinkSolutionValidator?: (routes: HighDensityIntraNodeRoute[]) => boolean
  captureSearchDebug: boolean

  failedSolvers: HighDensityIntraNodeSolver[]
  activeSubSolver: HighDensityIntraNodeSolver | null = null
  connMap?: ConnectivityMap
  nodePfById: Map<CapacityMeshNodeId, number | null>
  nodeSolveMetadataById: Map<
    CapacityMeshNodeId,
    {
      node: NodeWithPortPoints
      status: "solved" | "failed"
      solverType: string
      iterations: number
      routeCount: number
      nodePf: number | null
      error?: string
    }
  >

  private readonly binding: bindings.HighDensitySolver
  private readonly scope: PortfolioCallbackScope
  private readonly children = new Map<number, HighDensityIntraNodeSolver>()
  private readonly childIds = new WeakMap<HighDensityIntraNodeSolver, number>()
  private readonly externalChildren = new Set<number>()
  private activeChild: HighDensityIntraNodeSolver | null = null
  private readonly failedChildren = new Map<
    number,
    HighDensityIntraNodeSolver
  >()
  private readonly nodeReferences = new Map<string, NodeWithPortPoints>()
  private readonly stateValues: Record<string, unknown> = {}
  private readonly observed = new Set<string>()
  private syncing = false
  private readonly scalarValues: Record<string, unknown> = {}
  private readonly scalarDirty = new Set<string>()
  private readonly settingValues: Record<string, unknown> = {}
  private readonly diagnosticDirty = new Set<string>()
  private expectedQueueLength = 0
  private readonly boardKey: number
  private detachedParentState?: bindings.HighDensityBoardSnapshot
  private readonly routeAliases = new Map<number, HighDensityIntraNodeRoute>()

  constructor({
    nodePortPoints,
    colorMap,
    connMap,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    nodePfById,
    obstacles,
    layerCount,
    enableNegotiatedSearch = false,
    boardGeometry,
    useGrowShrinkHighDensityIntraNodeSolver,
    preserveTerminalPcbPortIds,
    growShrinkMaxInnerIterationsPerGrowthAttempt,
    growShrinkFallbackToInvalidGeometryOnFailure,
    growShrinkSolutionValidator,
    captureSearchDebug,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
    obstacleMargin?: number
    effort?: number
    obstacles?: Obstacle[]
    layerCount?: number
    enableNegotiatedSearch?: boolean
    boardGeometry?: HighDensityBoardGeometry
    useGrowShrinkHighDensityIntraNodeSolver?: boolean
    preserveTerminalPcbPortIds?: boolean
    growShrinkMaxInnerIterationsPerGrowthAttempt?: number
    growShrinkFallbackToInvalidGeometryOnFailure?: boolean
    growShrinkSolutionValidator?: (
      routes: HighDensityIntraNodeRoute[],
    ) => boolean
    captureSearchDebug?: boolean
    nodePfById?:
      | Map<CapacityMeshNodeId, number | null>
      | Record<string, number | null>
  }) {
    super()
    this.unsolvedNodePortPoints = nodePortPoints
    this.expectedQueueLength = nodePortPoints.length
    for (const node of nodePortPoints)
      this.nodeReferences.set(node.capacityMeshNodeId, node)
    this.colorMap = colorMap ?? {}
    this.connMap = connMap
    this.routes = []
    this.failedSolvers = []
    this.effort = effort ?? 1
    this.viaDiameter = viaDiameter ?? this.defaultViaDiameter
    this.traceWidth = traceWidth ?? this.defaultTraceThickness
    this.obstacleMargin = obstacleMargin ?? 0.15
    this.obstacles = obstacles ?? []
    this.layerCount = layerCount ?? 2
    this.enableNegotiatedSearch = enableNegotiatedSearch
    this.boardGeometry = boardGeometry
    this.useGrowShrinkHighDensityIntraNodeSolver =
      useGrowShrinkHighDensityIntraNodeSolver ?? false
    this.preserveTerminalPcbPortIds = preserveTerminalPcbPortIds ?? false
    this.growShrinkMaxInnerIterationsPerGrowthAttempt =
      growShrinkMaxInnerIterationsPerGrowthAttempt
    this.growShrinkFallbackToInvalidGeometryOnFailure =
      growShrinkFallbackToInvalidGeometryOnFailure ?? false
    this.growShrinkSolutionValidator = growShrinkSolutionValidator
    this.captureSearchDebug = captureSearchDebug ?? true
    this.MAX_ITERATIONS =
      10e6 *
      this.effort *
      (this.useGrowShrinkHighDensityIntraNodeSolver
        ? DEFAULT_MAX_GROWTH_ATTEMPTS + 1
        : 1)
    this.nodePfById =
      nodePfById instanceof Map
        ? new Map(nodePfById)
        : new Map(Object.entries(nodePfById ?? {}))
    this.nodeSolveMetadataById = new Map()
    this.stats = {
      solverNodeCount: {} as Record<string, number>,
      difficultNodePfs: {} as Record<string, number[]>,
      highDensityResizeCount: 0,
    }
    initializeAutorouterBindings()
    this.scope = PortfolioCallbackScope.current ?? new PortfolioCallbackScope()
    for (const field of [
      "unsolvedNodePortPoints",
      "routes",
      "colorMap",
      "obstacles",
      "connMap",
      "nodePfById",
      "nodeSolveMetadataById",
      "failedSolvers",
      "activeSubSolver",
      "stats",
    ]) {
      this.stateValues[field] = (this as unknown as Record<string, unknown>)[
        field
      ]
      Object.defineProperty(this, field, {
        configurable: true,
        enumerable: true,
        get: (): unknown => {
          if (!this.syncing) {
            this.observed.add(field)
            if (
              field === "routes" ||
              field === "activeSubSolver" ||
              field === "failedSolvers" ||
              field === "nodeSolveMetadataById" ||
              field === "stats"
            )
              this.syncSolverState()
          }
          if (
            !this.syncing &&
            !this.detachedParentState &&
            field !== "activeSubSolver"
          )
            this.diagnosticDirty.add(field)
          return this.stateValues[field]
        },
        set: (value: unknown): void => {
          this.stateValues[field] = value
          if (!this.syncing) {
            this.observed.add(field)
            this.diagnosticDirty.add(field)
          }
        },
      })
    }
    for (const field of [
      "MAX_ITERATIONS",
      "iterations",
      "solved",
      "failed",
      "error",
      "progress",
    ] as const) {
      this.scalarValues[field] = (this as unknown as Record<string, unknown>)[
        field
      ]
      Object.defineProperty(this, field, {
        configurable: true,
        enumerable: true,
        get: (): unknown => this.scalarValues[field],
        set: (value: unknown): void => {
          this.scalarValues[field] = value
          if (!this.syncing) this.scalarDirty.add(field)
        },
      })
    }
    const params = {
      nodePortPoints,
      viaDiameter,
      traceWidth,
      obstacleMargin,
      effort,
      nodePfById: this.getRelevantNodePfs(nodePortPoints),
      layerCount,
      useGrowShrinkHighDensityIntraNodeSolver,
      preserveTerminalPcbPortIds,
      growShrinkMaxInnerIterationsPerGrowthAttempt,
      growShrinkFallbackToInvalidGeometryOnFailure,
      captureSearchDebug,
    }
    const boardKey = this.scope.registerBoard(this)
    this.boardKey = boardKey
    for (const field of HighDensitySolver.settingFields)
      this.settingValues[field] = (this as unknown as Record<string, unknown>)[
        field
      ]
    this.binding = HighDensitySolver.createBinding(boardKey, params)
    this.syncSolverState()
  }

  private static createBinding(
    boardKey: number,
    params: bindings.HighDensityValue,
  ): bindings.HighDensitySolver {
    return new bindings.HighDensitySolver(
      params,
      (useGrowth: boolean): number => {
        const scope = PortfolioCallbackScope.current
        if (!scope)
          throw new Error(
            "High-density factory called outside its execution scope",
          )
        return (scope.getBoard(boardKey) as HighDensitySolver).createChild(
          useGrowth,
        )
      },
      (id: number): unknown => {
        const scope = PortfolioCallbackScope.current
        if (!scope)
          throw new Error(
            "High-density visualization called outside its execution scope",
          )
        return (scope.getBoard(boardKey) as HighDensitySolver).visualizeChild(
          id,
        )
      },
      safeTransparentize,
      (
        id: number,
        failed: boolean,
        generalState: bindings.HighDensityState | undefined,
        totalRoutes: number,
      ): void => {
        const scope = PortfolioCallbackScope.current
        if (!scope)
          throw new Error(
            "High-density completion called outside its execution scope",
          )
        scope
          .getBoard(boardKey)
          .completeChild(id, failed, generalState, totalRoutes)
      },
      (snapshot: bindings.HighDensityBoardSnapshot | null): void => {
        const scope = PortfolioCallbackScope.current
        if (!scope)
          throw new Error(
            "Parent validator observation requires its execution scope",
          )
        scope.getBoard(boardKey).observeDetachedParent(snapshot)
      },
    )
  }

  private createChild(useGrowth: boolean): number {
    const queue = this.stateValues
      .unsolvedNodePortPoints as NodeWithPortPoints[]
    const node = queue.pop()
    if (!node)
      throw new Error(
        "Native HighDensity requested a node from an empty input queue",
      )
    this.expectedQueueLength = queue.length
    this.nodeReferences.set(node.capacityMeshNodeId, node)
    const params = {
      nodeWithPortPoints: node,
      enableNegotiatedSearch: this.enableNegotiatedSearch,
      boardGeometry: this.boardGeometry,
      colorMap: this.stateValues.colorMap as Record<string, string>,
      connMap: this.stateValues.connMap as ConnectivityMap | undefined,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
      obstacles: this.stateValues.obstacles as Obstacle[],
      layerCount: this.layerCount,
      maxInnerIterationsPerGrowthAttempt:
        this.growShrinkMaxInnerIterationsPerGrowthAttempt,
      fallbackToInvalidGeometryOnFailure:
        this.growShrinkFallbackToInvalidGeometryOnFailure,
      growShrinkSolutionValidator: this.growShrinkSolutionValidator,
      captureSearchDebug: this.captureSearchDebug,
    }
    const child = useGrowth
      ? new GrowShrinkHighDensityIntraNodeSolver(params)
      : new PortfolioSingleIntraNodeSolver(params)
    const id = this.adoptChild(child)
    this.activeChild = child
    return id
  }

  private adoptChild(
    child: HighDensityIntraNodeSolver,
    external = false,
  ): number {
    const existing = this.childIds.get(child)
    if (existing !== undefined) return existing
    let id: number
    if (external) {
      const boardKey = this.boardKey
      id = bindings.HighDensitySolver.shareExternal(
        (method: string): unknown => {
          const scope = PortfolioCallbackScope.current
          if (!scope)
            throw new Error(
              "External child callback requires its execution scope",
            )
          return scope.getBoard(boardKey).externalChildAction(id, method)
        },
        this.getSolvedNodeSolverType(child),
      )
      this.externalChildren.add(id)
    } else if (child instanceof GrowShrinkHighDensityIntraNodeSolver)
      id = child.shareForOrchestration()
    else if (child instanceof PortfolioSingleIntraNodeSolver)
      id = this.scope.adopt(child)
    else
      id = bindings.HighDensitySolver.shareGeneral(
        child.shareForPortfolio(),
        {
          MAX_ITERATIONS: child.MAX_ITERATIONS,
          iterations: child.iterations,
          solved: child.solved,
          failed: child.failed,
          error: child.error,
          progress: child.progress,
        },
        child.nodeWithPortPoints,
        this.getSolvedNodeSolverType(child),
      )
    this.nodeReferences.set(
      child.nodeWithPortPoints.capacityMeshNodeId,
      child.nodeWithPortPoints,
    )
    this.childIds.set(child, id)
    this.children.set(id, child)
    return id
  }

  private getSolvedNodeSolverType(solver: HighDensityIntraNodeSolver): string {
    if (
      solver instanceof GrowShrinkHighDensityIntraNodeSolver &&
      solver.winningSolver
    ) {
      return this.getSolvedNodeSolverType(solver.winningSolver)
    }
    if (
      solver instanceof PortfolioSingleIntraNodeSolver &&
      solver.winningSolver
    ) {
      return this.getConcreteSolverTypeName(solver.winningSolver as BaseSolver)
    }
    return this.getConcreteSolverTypeName(solver)
  }

  private getConcreteSolverTypeName(solver: BaseSolver): string {
    if (solver instanceof CachedIntraNodeRouteSolver) {
      const concreteName = this.getIntraNodeStrategyName(solver.hyperParameters)
      return solver.cacheHit ? `${concreteName} [cached]` : concreteName
    }

    if (solver instanceof IntraNodeRouteSolver) {
      return this.getIntraNodeStrategyName(solver.hyperParameters)
    }

    return solver.getSolverName()
  }

  private getIntraNodeStrategyName(
    hyperParameters: Record<string, any> | undefined,
  ): string {
    if (hyperParameters?.MULTI_HEAD_POLYLINE_SOLVER) {
      return "MultiHeadPolyLineIntraNodeSolver3"
    }
    if (hyperParameters?.SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS) {
      return "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
    }
    if (hyperParameters?.CLOSED_FORM_SINGLE_TRANSITION) {
      return "SingleTransitionIntraNodeSolver"
    }
    if (hyperParameters?.CLOSED_FORM_TWO_TRACE_SAME_LAYER) {
      return "TwoCrossingRoutesHighDensitySolver"
    }
    if (hyperParameters?.CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING) {
      return "SingleTransitionCrossingRouteSolver"
    }
    if (hyperParameters?.HIGH_DENSITY_A01) {
      return "HighDensitySolverA01"
    }
    if (hyperParameters?.HIGH_DENSITY_A03) {
      return "HighDensitySolverA03"
    }
    return "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
  }

  private externalChildAction(id: number, method: string): unknown {
    const child = this.getChild(id)
    if (method === "step") {
      child.step()
      const cache = getGlobalInMemoryCache()
      bindings.HighDensitySolver.setCacheCounts(
        cache.cacheHits,
        cache.cacheMisses,
      )
    }
    if (method === "step" || method === "state")
      return {
        MAX_ITERATIONS: child.MAX_ITERATIONS,
        iterations: child.iterations,
        solved: child.solved,
        failed: child.failed,
        error: child.error,
        progress: child.progress,
        solverType: this.getSolvedNodeSolverType(child),
        growthAttempts:
          child instanceof GrowShrinkHighDensityIntraNodeSolver
            ? child.growthAttempts
            : undefined,
      }
    if (method === "routes") return child.solvedRoutes
    if (method === "node") return child.nodeWithPortPoints
    if (method === "visualize") return child.visualize()
    throw new Error(`Unknown external high-density child method ${method}`)
  }

  private getChild(id: number): HighDensityIntraNodeSolver {
    const child = this.failedChildren.get(id) ?? this.children.get(id)
    if (!child) throw new Error(`Unknown or released high-density child ${id}`)
    return child
  }

  private completeChild(
    id: number,
    failed: boolean,
    generalState: bindings.HighDensityState | undefined,
    totalRoutes: number,
  ): void {
    const child = this.getChild(id)
    if (generalState !== undefined && child instanceof IntraNodeRouteSolver) {
      const state = generalState
      Object.assign(child, state)
      child.syncPortfolioOutput()
    }
    if (!failed && this.observed.has("activeSubSolver")) {
      if (child instanceof GrowShrinkHighDensityIntraNodeSolver)
        child.syncSolverState()
      const routes = this.preserveTerminalPcbPortIds
        ? this.getSolvedRoutesWithTerminalPcbPortIds(child)
        : child.solvedRoutes
      const offset = totalRoutes - routes.length
      routes.forEach((route, index): void => {
        this.routeAliases.set(offset + index, route)
      })
    }
    if (failed) this.failedChildren.set(id, child)
    else {
      this.children.delete(id)
      this.childIds.delete(child)
    }
    if (!failed && child instanceof GrowShrinkHighDensityIntraNodeSolver)
      child.releaseOrchestrationScope()
    if (child === this.activeChild) this.activeChild = null
    if (
      !failed &&
      !this.observed.has("activeSubSolver") &&
      !this.externalChildren.has(id)
    ) {
      if (child instanceof GrowShrinkHighDensityIntraNodeSolver)
        child.disposeUnobserved()
      else if (child instanceof PortfolioSingleIntraNodeSolver)
        child.getPortfolioAdapter().disposeUnobserved()
    }
  }

  private getSolvedRoutesWithTerminalPcbPortIds(
    solver: HighDensityIntraNodeSolver,
  ): HighDensityIntraNodeRoute[] {
    const routes = solver.solvedRoutes
    if (
      !solver.nodeWithPortPoints.portPoints.some(
        (point) => point.pcb_port_id !== undefined,
      )
    )
      return routes
    const attached = bindings.HighDensitySolver.attachTerminalPcbPortIds(
      solver.nodeWithPortPoints,
      routes,
    )
    return routes.map((route, index) => ({
      ...route,
      startPcbPortId: attached[index]!.startPcbPortId,
      endPcbPortId: attached[index]!.endPcbPortId,
    }))
  }

  private visualizeChild(id: number): unknown {
    return this.getChild(id).visualize()
  }

  private encode(value: unknown): string {
    return JSON.stringify(value, (_key, entry: unknown): unknown =>
      entry instanceof Map ? Object.fromEntries(entry) : entry,
    )
  }

  private static readonly settingFields = [
    "viaDiameter",
    "traceWidth",
    "obstacleMargin",
    "effort",
    "layerCount",
    "useGrowShrinkHighDensityIntraNodeSolver",
    "preserveTerminalPcbPortIds",
    "growShrinkMaxInnerIterationsPerGrowthAttempt",
    "growShrinkFallbackToInvalidGeometryOnFailure",
    "captureSearchDebug",
  ] as const

  private getRelevantNodePfs(
    nodes: NodeWithPortPoints[],
  ): Map<CapacityMeshNodeId, number | null> {
    const source = this.stateValues.nodePfById as Map<
      CapacityMeshNodeId,
      number | null
    >
    const selected = new Map<CapacityMeshNodeId, number | null>()
    const ids = nodes.map((node) => node.capacityMeshNodeId)
    if (this.activeChild)
      ids.push(this.activeChild.nodeWithPortPoints.capacityMeshNodeId)
    for (const id of ids) if (source.has(id)) selected.set(id, source.get(id)!)
    return selected
  }

  private pushSolverState(stepArguments = false): void {
    const patch: Record<string, unknown> = {}
    for (const field of this.scalarDirty) {
      if (
        stepArguments &&
        (field === "iterations" || field === "MAX_ITERATIONS")
      )
        continue
      patch[field] = this.scalarValues[field]
    }
    for (const field of HighDensitySolver.settingFields) {
      const value = this[field]
      if (!Object.is(value, this.settingValues[field])) patch[field] = value
    }
    for (const field of this.observed) {
      if (field === "activeSubSolver") {
        const child = this.stateValues
          .activeSubSolver as HighDensityIntraNodeSolver | null
        patch.activeId = child === null ? null : this.adoptChild(child, true)
        this.activeChild = child
        if (!this.observed.has("nodePfById"))
          patch.nodePfById = this.getRelevantNodePfs(
            this.stateValues.unsolvedNodePortPoints as NodeWithPortPoints[],
          )
      } else if (field === "failedSolvers") {
        patch.failedIds = (
          this.stateValues.failedSolvers as HighDensityIntraNodeSolver[]
        ).map((child) => this.adoptChild(child, true))
      } else if (
        field !== "connMap" &&
        field !== "obstacles" &&
        field !== "colorMap"
      )
        patch[field] = this.stateValues[field]
    }
    const queue = this.stateValues
      .unsolvedNodePortPoints as NodeWithPortPoints[]
    if (queue.length !== this.expectedQueueLength)
      patch.unsolvedNodePortPoints = queue
    if (
      Object.hasOwn(patch, "unsolvedNodePortPoints") &&
      !this.observed.has("nodePfById")
    ) {
      patch.nodePfById = this.getRelevantNodePfs(queue)
    }
    if (Object.keys(patch).length > 0)
      this.scope.run((): void => this.binding.restore(patch))
    for (const field of HighDensitySolver.settingFields)
      this.settingValues[field] = this[field]
    this.expectedQueueLength = queue.length
    this.scalarDirty.clear()
    this.diagnosticDirty.clear()
    const cache = getGlobalInMemoryCache()
    bindings.HighDensitySolver.setCacheCounts(
      cache.cacheHits,
      cache.cacheMisses,
    )
  }

  private observeDetachedParent(
    snapshot: bindings.HighDensityBoardSnapshot | null,
  ): void {
    this.detachedParentState = snapshot ?? undefined
    if (this.detachedParentState) this.syncSolverState()
  }

  private syncSolverState(): void {
    if (this.syncing || !this.binding) return
    this.syncing = true
    try {
      if (!this.detachedParentState) this.scope.sync()
      const state = this.detachedParentState ?? this.binding.state()
      for (const field of [
        "MAX_ITERATIONS",
        "iterations",
        "solved",
        "failed",
        "error",
        "progress",
      ] as const) {
        if (!this.scalarDirty.has(field))
          (this as unknown as Record<string, unknown>)[field] =
            field === "progress" ? (state[field] ?? Number.NaN) : state[field]
      }
      reconcileObservedValue(this.stateValues.stats, state.stats)
      if (
        this.observed.has("nodeSolveMetadataById") &&
        !this.diagnosticDirty.has("nodeSolveMetadataById")
      ) {
        const incomingMetadata =
          this.detachedParentState?.nodeSolveMetadataById ??
          this.binding.metadata()
        const metadata = this.stateValues.nodeSolveMetadataById as Map<
          string,
          unknown
        >
        for (const id of metadata.keys())
          if (!Object.hasOwn(incomingMetadata, id)) metadata.delete(id)
        for (const [id, incoming] of Object.entries(incomingMetadata)) {
          const value = incoming as Record<string, unknown>
          const node = this.nodeReferences.get(id)
          if (node) value.node = node
          const previous = metadata.get(id) as
            | Record<string, unknown>
            | undefined
          const retainedNode = value.node
          const next = reconcileObservedValue(previous, {
            ...value,
            node: undefined,
          }) as Record<string, unknown>
          next.node = retainedNode
          if (!Object.hasOwn(next, "error")) next.error = undefined
          metadata.set(id, next)
        }
      }
      if (this.observed.has("routes") && !this.diagnosticDirty.has("routes")) {
        const routes = this.stateValues.routes as HighDensityIntraNodeRoute[]
        const incoming =
          this.detachedParentState?.routes ?? this.binding.routes()
        reconcileObservedValue(routes, incoming)
        for (const [index, route] of this.routeAliases)
          if (index < routes.length) routes[index] = route
      }
      const activeId = state.activeId
      const failedIds = state.failedIds
      for (const id of failedIds)
        if (!this.failedChildren.has(id))
          this.failedChildren.set(id, this.getChild(id))
      for (const id of this.failedChildren.keys())
        if (!failedIds.includes(id)) this.failedChildren.delete(id)
      this.activeChild = activeId === null ? null : this.getChild(activeId)
      if (
        !this.detachedParentState &&
        this.activeChild instanceof IntraNodeRouteSolver &&
        !this.externalChildren.has(activeId!)
      ) {
        Object.assign(this.activeChild, this.binding.childState(activeId!))
        this.activeChild.syncPortfolioOutput()
      }
      if (!this.diagnosticDirty.has("activeSubSolver"))
        this.stateValues.activeSubSolver = this.activeChild
      const failed = this.stateValues
        .failedSolvers as HighDensityIntraNodeSolver[]
      if (!this.diagnosticDirty.has("failedSolvers"))
        failed.splice(
          0,
          failed.length,
          ...failedIds.map((id) => this.getChild(id)),
        )
    } finally {
      this.syncing = false
    }
  }

  override _step(): void {
    this.pushSolverState(true)
    let completed = false
    let status = 0
    try {
      status = this.scope.run((): number =>
        this.binding.stepInner(this.iterations, this.MAX_ITERATIONS),
      )
      completed = true
    } finally {
      if (!completed || status !== 0 || this.observed.size > 0)
        this.syncSolverState()
    }
  }

  override solve(): void {
    const start = Date.now()
    this.pushSolverState()
    try {
      this.scope.run((): void => this.binding.solve())
    } finally {
      this.syncSolverState()
    }
    this.timeToSolve = Date.now() - start
  }

  override visualize(): GraphicsObject {
    this.pushSolverState()
    return this.scope.run((): GraphicsObject => {
      this.binding.restore({ colorMap: this.stateValues.colorMap })
      return this.binding.visualize()
    })
  }
}

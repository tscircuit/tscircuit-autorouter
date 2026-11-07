import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { preparePipeline9RepairConnectivity } from "./preparePipeline9RepairConnectivity"
import { NegotiateTraceClearanceSolver } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "../AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import type { HighDensityRoute } from "lib/types/high-density-types"

type NegotiatedClearanceParams = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedRoutes: HighDensityRoute[]
  effort: number
  connMap?: ConnectivityMap
  preloaded?: {
    traces: SimplifiedPcbTraces
    viaDiameter: number
    viaHoleDiameter: number
  }
  evaluate: (
    routes: HighDensityRoute[],
    preloadedTraces: SimplifiedPcbTraces,
  ) => {
    errorCount: number
    dirtyRouteIndices: number[]
  }
}

/** Whole-board negotiation lets interacting repairs move together at higher effort. */
export class Pipeline9NegotiatedClearanceSolver extends BaseSolver {
  readonly params: NegotiatedClearanceParams
  bestRoutes: HighDensityRoute[]
  private readonly initialPreloadedRoutes: HighDensityRoute[]
  bestErrorCount: number | undefined
  private dirtyRouteIndices: number[] = []
  completedPasses = 0
  negotiationSolver?: NegotiateTraceClearanceSolver

  constructor(params: NegotiatedClearanceParams) {
    super()
    this.params = params
    this.initialPreloadedRoutes = (params.preloaded?.traces ?? [])
      .filter((trace) => trace.isFixed !== true)
      .map((trace): HighDensityRoute => {
        const net = params.connMap?.getNetConnectedToId(trace.connection_name)
        if (!net)
          throw new Error(
            `Preloaded trace "${trace.pcb_trace_id}" has no declared net`,
          )
        return convertSimplifiedPcbTraceToHighDensityRoute(trace, {
          layerCount: params.srj.layerCount,
          defaultTraceThickness: params.srj.minTraceWidth,
          defaultViaDiameter: params.preloaded!.viaDiameter,
          rootConnectionName: net,
        })
      })
    this.bestRoutes = [...params.routes, ...this.initialPreloadedRoutes]
    if (params.effort <= 1) {
      this.solved = true
      return
    }
    const initial = this.evaluateRoutes(this.bestRoutes)
    this.bestErrorCount = initial.errorCount
    this.dirtyRouteIndices = initial.dirtyRouteIndices
    this.stats = { initialErrorCount: this.bestErrorCount }
    if (this.bestErrorCount === 0 || this.dirtyRouteIndices.length === 0) {
      this.solved = true
      return
    }
    this.startNegotiation()
  }

  private startNegotiation(): void {
    const { params } = this
    const candidateRoutes = structuredClone([
      ...this.bestRoutes,
      ...params.fixedRoutes,
    ])
    const { srj, routes } = params.connMap
      ? preparePipeline9RepairConnectivity({
          srj: params.srj,
          routes: candidateRoutes,
          connMap: params.connMap,
        })
      : { srj: params.srj, routes: candidateRoutes }
    const movableCount = this.bestRoutes.length
    const clearance =
      params.srj.minTraceToPadEdgeClearance ??
      params.srj.defaultObstacleMargin ??
      0.1
    this.negotiationSolver = new NegotiateTraceClearanceSolver({
      // Fixed copper is supplied as locked HD routes, including through-obstacle metadata.
      srj: { ...srj, traces: undefined },
      routes,
      bounds: params.srj.bounds,
      dirtyRouteIndices: this.dirtyRouteIndices,
      fixedRouteIndices: params.fixedRoutes.map(
        (_, index) => movableCount + index,
      ),
      isLocked: (routeIndex, pointIndex): boolean =>
        routeIndex >= movableCount ||
        pointIndex === 0 ||
        pointIndex === routes[routeIndex]!.route.length - 1 ||
        routes[routeIndex]!.route[pointIndex]!.terminalApproach !== undefined,
      allowLayerChanges: true,
      traceClearance: clearance,
      viaClearance: params.srj.minViaEdgeToPadEdgeClearance ?? clearance,
      viaHoleDiameter: params.srj.minViaHoleDiameter,
      maxPathSearchNodes: Math.ceil(50_000_000 * params.effort),
      maxPathSearchNodesPerCall: 300_000,
      pathHeuristicWeight: 3,
      pathGridSizeScale: 1,
      searchDirectionCount: 2,
      maxPathSearchCalls: Math.ceil(2_500 * params.effort),
    })
    this.MAX_ITERATIONS += this.negotiationSolver.MAX_ITERATIONS + 2
  }

  override _step(): void {
    const child = this.negotiationSolver
    if (!child) throw new Error("Negotiated clearance has no active search")
    child.step()
    this.stats = {
      ...this.stats,
      ...child.stats,
      completedPasses: this.completedPasses,
      remainingErrorCount: this.bestErrorCount,
    }
    if (child.failed) {
      this.failed = true
      this.error = child.error
      return
    }
    if (!child.solved) return
    const candidate = child
      .getOutput()
      .routes.slice(0, this.bestRoutes.length)
      .map(
        (route, index): HighDensityRoute => ({
          ...route,
          rootConnectionName: this.bestRoutes[index]!.rootConnectionName,
        }),
      )
    const evaluated = this.evaluateRoutes(candidate)
    const errorCount = evaluated.errorCount
    this.completedPasses++
    const improved = errorCount < this.bestErrorCount!
    if (improved) {
      this.bestRoutes = candidate
      this.bestErrorCount = errorCount
      this.dirtyRouteIndices = evaluated.dirtyRouteIndices
    }
    this.stats.remainingErrorCount = this.bestErrorCount
    this.stats.completedPasses = this.completedPasses
    if (
      improved &&
      errorCount > 0 &&
      this.dirtyRouteIndices.length > 0 &&
      this.completedPasses < Math.ceil(this.params.effort)
    ) {
      this.startNegotiation()
      return
    }
    // Budget exhaustion is visible in remainingErrorCount and final DRC.
    // Keep the independently evaluated best candidate, never a transient search.
    this.solved = true
  }

  private convertPreloadedRoutes(
    routes: HighDensityRoute[],
  ): SimplifiedPcbTraces {
    let index = 0
    return (this.params.preloaded?.traces ?? []).map((trace) => {
      if (trace.isFixed === true) return trace
      const original = this.initialPreloadedRoutes[index]!
      const route = routes[index++]
      if (!route)
        throw new Error(
          `Missing negotiated preloaded trace "${trace.pcb_trace_id}"`,
        )
      if (JSON.stringify(route.route) === JSON.stringify(original.route))
        return trace
      return {
        ...trace,
        route: convertHdRouteToSimplifiedRoute(
          route,
          this.params.srj.layerCount,
          {
            defaultViaHoleDiameter: this.params.preloaded!.viaHoleDiameter,
            obstacles: this.params.srj.obstacles,
            connMap: this.params.connMap,
          },
        ),
      }
    })
  }

  private evaluateRoutes(
    routes: HighDensityRoute[],
  ): ReturnType<NegotiatedClearanceParams["evaluate"]> {
    return this.params.evaluate(
      routes.slice(0, this.params.routes.length),
      this.convertPreloadedRoutes(routes.slice(this.params.routes.length)),
    )
  }

  getUpdatedPreloadedTraces(): SimplifiedPcbTraces {
    if (!this.solved) throw new Error("Negotiated clearance is not complete")
    return this.convertPreloadedRoutes(
      this.bestRoutes.slice(this.params.routes.length),
    )
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Negotiated clearance is not complete")
    return this.bestRoutes.slice(0, this.params.routes.length)
  }
}

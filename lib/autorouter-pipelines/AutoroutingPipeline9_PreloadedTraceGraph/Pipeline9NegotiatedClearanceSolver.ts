import { NegotiateTraceClearanceSolver } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type NegotiatedClearanceParams = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedRoutes: HighDensityRoute[]
  effort: number
  countErrors: (routes: HighDensityRoute[]) => number
}

/** Whole-board negotiation lets interacting repairs move together at higher effort. */
export class Pipeline9NegotiatedClearanceSolver extends BaseSolver {
  readonly params: NegotiatedClearanceParams
  bestRoutes: HighDensityRoute[]
  bestErrorCount: number | undefined
  completedPasses = 0
  negotiationSolver?: NegotiateTraceClearanceSolver

  constructor(params: NegotiatedClearanceParams) {
    super()
    this.params = params
    this.bestRoutes = params.routes
    if (params.effort <= 1) {
      this.solved = true
      return
    }
    this.bestErrorCount = params.countErrors(this.bestRoutes)
    this.stats = { initialErrorCount: this.bestErrorCount }
    if (this.bestErrorCount === 0) {
      this.solved = true
      return
    }
    this.startNegotiation()
  }

  private startNegotiation(): void {
    const { params } = this
    const routes = structuredClone([...this.bestRoutes, ...params.fixedRoutes])
    const movableCount = this.bestRoutes.length
    const clearance =
      params.srj.minTraceToPadEdgeClearance ??
      params.srj.defaultObstacleMargin ??
      0.1
    this.negotiationSolver = new NegotiateTraceClearanceSolver({
      // Fixed copper is supplied as locked HD routes, including through-obstacle metadata.
      srj: { ...params.srj, traces: undefined },
      routes,
      bounds: params.srj.bounds,
      dirtyRouteIndices: this.bestRoutes.map((_, index) => index),
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
    const candidate = child.getOutput().routes.slice(0, this.bestRoutes.length)
    const errorCount = this.params.countErrors(candidate)
    this.completedPasses++
    const improved = errorCount < this.bestErrorCount!
    if (improved) {
      this.bestRoutes = candidate
      this.bestErrorCount = errorCount
    }
    this.stats.remainingErrorCount = this.bestErrorCount
    this.stats.completedPasses = this.completedPasses
    if (
      improved &&
      errorCount > 0 &&
      this.completedPasses < Math.ceil(this.params.effort)
    ) {
      this.startNegotiation()
      return
    }
    // Budget exhaustion is visible in remainingErrorCount and final DRC.
    // Keep the independently evaluated best candidate, never a transient search.
    this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Negotiated clearance is not complete")
    return this.bestRoutes
  }
}

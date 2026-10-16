import {
  TraceSimplificationSolver,
  UselessViaRemovalSolver,
} from "@tscircuit/trace-simplification-solver"
import { FindClearancePathSolver } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getSameLayerViaRemovalInput } from "./getSameLayerViaRemovalInput"
import { get45DegreeViaRemovalPath } from "./get45DegreeViaRemovalPath"

type CleanupCost = { vias: number; points: number }
type CleanupParams = {
  config: ConstructorParameters<typeof TraceSimplificationSolver>[0]
  effort: number
  srj: SimpleRouteJson
  getCost: (routes: HighDensityRoute[]) => CleanupCost
  isValid: (routes: HighDensityRoute[]) => boolean
}

/** Post-repair cleanup commits only valid improvements, including at default effort. */
export class Pipeline9EffortCleanupSolver extends BaseSolver {
  bestRoutes: HighDensityRoute[]
  bestCost: CleanupCost
  completedPasses = 0
  readonly cleanupPasses: number
  simplifier?: TraceSimplificationSolver
  viaRemovalSolver?: UselessViaRemovalSolver
  readonly params: CleanupParams
  private sameLayerRouteIndex?: number
  private sameLayerPathSolver?: FindClearancePathSolver
  private sameLayerRoutes?: HighDensityRoute[]
  private viaRemovalRoutes?: HighDensityRoute[]

  constructor(params: CleanupParams) {
    super()
    this.params = params
    this.bestRoutes = structuredClone([...params.config.hdRoutes])
    this.bestCost = params.getCost(this.bestRoutes)
    this.cleanupPasses = params.effort <= 1 ? 1 : Math.ceil(2 * params.effort)
    this.MAX_ITERATIONS = 100e6 * Math.max(1, this.cleanupPasses)
    if (params.effort <= 1) {
      const config = params.config
      // Path sampling already ran before repair. Only revisit removable vias
      // at default effort; repeated path and crossing searches are expensive.
      this.viaRemovalSolver = new UselessViaRemovalSolver({
        unsimplifiedHdRoutes: structuredClone(this.bestRoutes),
        otherHdRoutes: config.otherHdRoutes,
        obstacles: [...config.obstacles],
        colorMap: config.colorMap,
        layerCount: config.layerCount,
        connMap: config.connMap,
        outline: config.outline ? [...config.outline] : undefined,
        geometryShortcutTraceMargin: 0.1,
        geometryShortcutObstacleMargin:
          config.minTraceToPadEdgeClearance ?? 0.15,
        enableGeometryShortcuts: true,
        enableRoutedTraceDetours: true,
        enableObstacleDetourShortcuts: config.enableCrossingViaReduction,
        preserveRouteEndpoints: config.preserveRouteEndpoints,
        terminalLayerIndicesByPcbPortId: config.terminalLayerIndicesByPcbPortId,
      })
      this.viaRemovalSolver.MAX_ITERATIONS = this.MAX_ITERATIONS
      return
    }
    this.simplifier = new TraceSimplificationSolver({
      ...params.config,
      enableRoutedTraceDetours: true,
      hdRoutes: structuredClone(this.bestRoutes),
    })
    // Pre-repair path simplification has already reduced the route points.
    // Enable geometry shortcuts from the first post-repair pass.
    this.simplifier.simplificationPipelineLoops = 2
    this.simplifier.MAX_SIMPLIFICATION_PIPELINE_LOOPS = 2 + this.cleanupPasses
    this.simplifier.MAX_ITERATIONS = this.MAX_ITERATIONS
  }

  override _step(): void {
    if (this.sameLayerRouteIndex !== undefined) {
      this.stepSameLayerViaRemoval()
      return
    }
    if (this.viaRemovalSolver) {
      const remover = this.viaRemovalSolver
      remover.step()
      if (remover.failed) {
        this.failed = true
        this.error = remover.error
        return
      }
      if (!remover.solved) return
      const candidate = remover.getOptimizedHdRoutes()
      if (!candidate) throw new Error("Via removal has no output")
      this.completedPasses = 1
      this.viaRemovalSolver = undefined
      this.viaRemovalRoutes = candidate
      this.sameLayerRoutes = candidate
      this.sameLayerRouteIndex = 0
      return
    }
    const simplifier = this.simplifier
    if (!simplifier) throw new Error("Cleanup has no active simplifier")
    const previousPhase = simplifier.currentPhase
    const previousLoops = simplifier.simplificationPipelineLoops
    simplifier.step()
    if (simplifier.failed) {
      this.failed = true
      this.error = simplifier.error
      return
    }
    const completedPasses = simplifier.simplificationPipelineLoops - 2
    this.completedPasses = completedPasses
    // Keep legal via reductions before a later path pass can invalidate them.
    if (
      simplifier.currentPhase !== previousPhase ||
      simplifier.simplificationPipelineLoops !== previousLoops
    ) {
      const candidate = simplifier.simplifiedHdRoutes
      const cost = this.params.getCost(candidate)
      const improves =
        cost.vias < this.bestCost.vias ||
        (cost.vias === this.bestCost.vias && cost.points < this.bestCost.points)
      if (improves && this.params.isValid(candidate)) {
        this.bestRoutes = structuredClone(candidate)
        this.bestCost = cost
      }
    }
    if (simplifier.solved) {
      this.sameLayerRoutes = this.bestRoutes
      this.sameLayerRouteIndex = 0
    }
  }

  private stepSameLayerViaRemoval(): void {
    const routeIndex = this.sameLayerRouteIndex!
    const routes = this.sameLayerRoutes!
    if (routeIndex >= routes.length) {
      const candidates = [routes]
      if (this.viaRemovalRoutes && this.viaRemovalRoutes !== routes) {
        candidates.push(this.viaRemovalRoutes)
      }
      // Check the complete cleanup once; retain the original via-only pass
      // when the additional same-layer paths violate board rules.
      for (const candidate of candidates) {
        const cost = this.params.getCost(candidate)
        if (cost.vias < this.bestCost.vias && this.params.isValid(candidate)) {
          this.bestRoutes = candidate
          this.bestCost = cost
          break
        }
      }
      this.sameLayerRoutes = undefined
      this.viaRemovalRoutes = undefined
      this.sameLayerRouteIndex = undefined
      this.solved = true
      return
    }
    if (!this.sameLayerPathSolver) {
      const sameLayerViaRemovalInput = getSameLayerViaRemovalInput({
        srj: this.params.srj,
        routes,
        fixedRoutes: this.params.config.otherHdRoutes ?? [],
        routeIndex,
      })
      if (!sameLayerViaRemovalInput) {
        this.sameLayerRouteIndex = routeIndex + 1
        return
      }
      this.sameLayerPathSolver = new FindClearancePathSolver(
        sameLayerViaRemovalInput,
      )
      return
    }
    const solver = this.sameLayerPathSolver
    solver.step()
    if (solver.failed) {
      this.failed = true
      this.error = solver.error
      return
    }
    if (!solver.solved) return
    const path = solver.getOutput()
    this.sameLayerPathSolver = undefined
    this.sameLayerRouteIndex = routeIndex + 1
    if (!path) return
    const candidate = [...routes]
    const route = candidate[routeIndex]!
    const startIndex = route.route.indexOf(solver.input.start)
    const endIndex = route.route.indexOf(solver.input.end)
    if (startIndex < 0 || endIndex < startIndex) {
      throw new Error("Via removal anchors must belong to the original route")
    }
    candidate[routeIndex] = {
      ...route,
      route: [
        ...route.route.slice(0, startIndex),
        ...get45DegreeViaRemovalPath(path),
        ...route.route.slice(endIndex + 1),
      ],
      vias: [],
    }
    this.sameLayerRoutes = candidate
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Cleanup is not complete")
    return this.bestRoutes
  }
}

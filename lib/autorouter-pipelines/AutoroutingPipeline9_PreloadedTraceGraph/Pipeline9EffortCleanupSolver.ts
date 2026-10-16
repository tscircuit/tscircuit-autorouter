import {
  TraceSimplificationSolver,
  UselessViaRemovalSolver,
} from "@tscircuit/trace-simplification-solver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type CleanupCost = { vias: number; points: number }
type CleanupParams = {
  config: ConstructorParameters<typeof TraceSimplificationSolver>[0]
  effort: number
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
  private routeCandidates?: HighDensityRoute[]
  private candidateRouteIndex = 0

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
    if (this.routeCandidates) {
      const routeIndex = this.candidateRouteIndex++
      if (routeIndex >= this.routeCandidates.length) {
        this.completedPasses = 1
        this.solved = true
        return
      }
      const candidate = [...this.bestRoutes]
      candidate[routeIndex] = this.routeCandidates[routeIndex]!
      const cost = this.params.getCost(candidate)
      if (cost.vias < this.bestCost.vias && this.params.isValid(candidate)) {
        this.bestRoutes = structuredClone(candidate)
        this.bestCost = cost
      }
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
      const cost = this.params.getCost(candidate)
      if (cost.vias < this.bestCost.vias) {
        if (this.params.isValid(candidate)) {
          this.bestRoutes = structuredClone(candidate)
          this.bestCost = cost
        } else {
          // One invalid shortcut must not discard independent legal reductions.
          this.routeCandidates = candidate
          return
        }
      }
      this.completedPasses = 1
      this.solved = true
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
    this.solved = simplifier.solved
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Cleanup is not complete")
    return this.bestRoutes
  }
}

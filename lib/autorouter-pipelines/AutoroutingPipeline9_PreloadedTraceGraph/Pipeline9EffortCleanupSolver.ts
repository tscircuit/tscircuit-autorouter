import {
  TraceSimplificationSolver,
  VertexShortcutPathSolver,
} from "@tscircuit/trace-simplification-solver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

type CleanupCost = { vias: number; points: number }
type CleanupParams = {
  config: ConstructorParameters<typeof TraceSimplificationSolver>[0]
  effort: number
  getCost: (routes: HighDensityRoute[]) => CleanupCost
  isValid: (routes: HighDensityRoute[]) => boolean
}

/** Extra cleanup is an optimization: invalid or worse candidates are never committed. */
export class Pipeline9EffortCleanupSolver extends BaseSolver {
  bestRoutes: HighDensityRoute[]
  bestCost: CleanupCost
  completedPasses = 0
  readonly extraPasses: number
  simplifier?: TraceSimplificationSolver
  readonly params: CleanupParams
  private shortcutRouteIndex = 0
  private shortcutSolver?: VertexShortcutPathSolver

  constructor(params: CleanupParams) {
    super()
    this.params = params
    this.bestRoutes = structuredClone([...params.config.hdRoutes])
    this.bestCost = params.getCost(this.bestRoutes)
    this.extraPasses = Math.max(0, Math.ceil(2 * (params.effort - 1)))
    this.MAX_ITERATIONS = 100e6 * Math.max(1, this.extraPasses)
    if (this.extraPasses === 0) {
      this.solved = !params.config.enableVertexShortcuts
      return
    }
  }

  override _step(): void {
    if (
      this.params.config.enableVertexShortcuts &&
      this.shortcutRouteIndex < this.bestRoutes.length
    ) {
      this.stepVertexShortcuts()
      return
    }
    if (this.extraPasses === 0) {
      this.solved = true
      return
    }
    if (!this.simplifier) {
      this.simplifier = new TraceSimplificationSolver({
        ...this.params.config,
        hdRoutes: structuredClone(this.bestRoutes),
      })
      // Continue after the two pre-repair simplification passes.
      this.simplifier.simplificationPipelineLoops = 2
      this.simplifier.MAX_SIMPLIFICATION_PIPELINE_LOOPS = 2 + this.extraPasses
      this.simplifier.MAX_ITERATIONS = this.MAX_ITERATIONS
    }
    const simplifier = this.simplifier
    simplifier.step()
    if (simplifier.failed) {
      this.failed = true
      this.error = simplifier.error
      return
    }
    const completedPasses = simplifier.simplificationPipelineLoops - 2
    if (completedPasses > this.completedPasses) {
      this.completedPasses = completedPasses
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

  private stepVertexShortcuts(): void {
    const routeIndex = this.shortcutRouteIndex
    if (!this.shortcutSolver) {
      this.shortcutSolver = new VertexShortcutPathSolver({
        inputRoute: this.bestRoutes[routeIndex]!,
        obstacles: createObjectsWithZLayers(
          this.params.config.obstacles,
          this.params.config.layerCount,
        ),
        connMap: this.params.config.connMap,
        colorMap: this.params.config.colorMap,
        outline: this.params.config.outline?.map((point) => ({ ...point })),
        minBoardEdgeClearance: this.params.config.minBoardEdgeClearance,
        useTraceWidthAwareClearance: this.params.config.useTraceWidthAwareClearance,
        otherHdRoutes: [
          ...this.bestRoutes.filter((_, index) => index !== routeIndex),
          ...(this.params.config.otherHdRoutes ?? []),
        ],
      })
    }
    this.shortcutSolver.step()
    if (this.shortcutSolver.failed) {
      this.failed = true
      this.error = this.shortcutSolver.error
      return
    }
    if (!this.shortcutSolver.solved) return
    const candidate = [...this.bestRoutes]
    candidate[routeIndex] = this.shortcutSolver.simplifiedRoute
    const cost = this.params.getCost(candidate)
    if (cost.points < this.bestCost.points && this.params.isValid(candidate)) {
      this.bestRoutes = candidate
      this.bestCost = cost
    }
    this.shortcutSolver = undefined
    this.shortcutRouteIndex++
  }
}

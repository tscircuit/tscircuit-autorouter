import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

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

  constructor(params: CleanupParams) {
    super()
    this.params = params
    this.bestRoutes = structuredClone([...params.config.hdRoutes])
    this.bestCost = params.getCost(this.bestRoutes)
    this.extraPasses = Math.max(0, Math.ceil(2 * (params.effort - 1)))
    this.MAX_ITERATIONS = 100e6 * Math.max(1, this.extraPasses)
    if (this.extraPasses === 0) {
      this.solved = true
      return
    }
    this.simplifier = new TraceSimplificationSolver({
      ...params.config,
      hdRoutes: structuredClone(this.bestRoutes),
    })
    // The baseline has already completed two passes. Enable the geometry
    // shortcuts intended for subsequent passes on the repaired routes.
    this.simplifier.simplificationPipelineLoops = 2
    this.simplifier.MAX_SIMPLIFICATION_PIPELINE_LOOPS = 2 + this.extraPasses
    this.simplifier.MAX_ITERATIONS = this.MAX_ITERATIONS
  }

  override _step(): void {
    const simplifier = this.simplifier
    if (!simplifier) throw new Error("Cleanup has no active simplifier")
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
}

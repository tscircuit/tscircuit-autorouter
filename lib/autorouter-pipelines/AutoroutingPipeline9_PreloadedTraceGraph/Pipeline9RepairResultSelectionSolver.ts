import {
  type DrcEvaluator,
  type TraceContactGuard,
  TraceContactRepairSolver,
  type TraceContactRepairSolverParams,
} from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { isPipeline9DrcPriorityImprovement } from "./isPipeline9DrcPriorityImprovement"
import {
  getPipeline9DrcErrors,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type Pipeline9RepairResultSelectionParams = {
  regionalRepairRoutes: HighDensityRoute[]
  preRegionalRepairRoutes: HighDensityRoute[]
  traceContactGuard: TraceContactGuard
  drcEvaluator: DrcEvaluator
  traceContactRepairParams: Omit<
    TraceContactRepairSolverParams,
    "hdRoutes" | "tracePairDrcEvaluator" | "deferTraceContactGuard"
  >
}

type EvaluatedRepairResult = {
  routes: HighDensityRoute[]
  errors: Pipeline9DrcError[]
}

/**
 * Compare the routes after bounded regional repair with the routes saved
 * before regional repair. Check each version for new shorts relative to the
 * input routes and run `TraceContactRepairSolver` when needed. Score both
 * versions with the same DRC evaluator and Pipeline 9's existing priorities.
 * A zero-error result ends the comparison. The regional result wins ties.
 */
export class Pipeline9RepairResultSelectionSolver extends BaseSolver {
  private readonly routeSets: HighDensityRoute[][]
  private nextRouteSetIndex = 0
  private bestRepairResult?: EvaluatedRepairResult

  constructor(readonly params: Pipeline9RepairResultSelectionParams) {
    super()
    this.routeSets = [params.regionalRepairRoutes]
    if (
      JSON.stringify(params.regionalRepairRoutes) !==
      JSON.stringify(params.preRegionalRepairRoutes)
    ) {
      this.routeSets.push(params.preRegionalRepairRoutes)
    }
  }

  override getConstructorParams(): [Pipeline9RepairResultSelectionParams] {
    return [this.params]
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || !this.bestRepairResult) {
      throw new Error("Pipeline9 repair result selection requires a solve")
    }
    return this.bestRepairResult.routes
  }

  private considerRepairResult(
    routes: HighDensityRoute[],
    repairStats?: Record<string, unknown>,
  ): void {
    const errors = getPipeline9DrcErrors(this.params.drcEvaluator, routes)
    if (
      !this.bestRepairResult ||
      isPipeline9DrcPriorityImprovement({
        currentErrors: this.bestRepairResult.errors,
        candidateErrors: errors,
      })
    ) {
      this.bestRepairResult = { routes, errors }
      this.stats = {
        ...repairStats,
        finalDrcIssueCount: errors.length,
      }
    }
    this.solved =
      errors.length === 0 || this.nextRouteSetIndex === this.routeSets.length
    this.progress = this.solved
      ? 1
      : this.nextRouteSetIndex / this.routeSets.length
  }

  override _step(): void {
    const repair = this.activeSubSolver
    if (repair instanceof TraceContactRepairSolver) {
      repair.step()
      if (repair.failed) {
        this.failed = true
        this.error = repair.error
        this.activeSubSolver = null
        return
      }
      if (!repair.solved) return

      const routes = repair.getOutput()
      if (this.params.traceContactGuard.getNewContactPairs(routes).length > 0) {
        throw new Error("Pipeline9 trace contact repair published a new short")
      }
      this.activeSubSolver = null
      this.considerRepairResult(routes, repair.stats)
      return
    }

    const routes = this.routeSets[this.nextRouteSetIndex]
    if (!routes) {
      throw new Error(
        "Pipeline9 repair result selection has no routes to check",
      )
    }
    this.nextRouteSetIndex++
    if (this.params.traceContactGuard.getNewContactPairs(routes).length === 0) {
      this.considerRepairResult(routes)
      return
    }

    const traceContactRepairSolver = new TraceContactRepairSolver({
      ...this.params.traceContactRepairParams,
      hdRoutes: routes,
      tracePairDrcEvaluator: this.params.drcEvaluator,
      deferTraceContactGuard: false,
    })
    this.activeSubSolver = traceContactRepairSolver
    // Account for the active child using its existing iteration limit.
    this.MAX_ITERATIONS = Math.max(
      this.MAX_ITERATIONS,
      this.iterations + traceContactRepairSolver.MAX_ITERATIONS + 1,
    )
  }
}

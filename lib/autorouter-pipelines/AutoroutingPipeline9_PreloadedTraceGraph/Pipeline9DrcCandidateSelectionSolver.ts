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

type Pipeline9DrcCandidateSelectionParams = {
  regionalRoutes: HighDensityRoute[]
  preRegionalRoutes: HighDensityRoute[]
  contactGuard: TraceContactGuard
  referenceDrcEvaluator: DrcEvaluator
  contactRepairParams: Omit<
    TraceContactRepairSolverParams,
    "hdRoutes" | "tracePairDrcEvaluator" | "deferTraceContactGuard"
  >
}

type ValidatedCandidate = {
  routes: HighDensityRoute[]
  errors: Pipeline9DrcError[]
}

/** Compare the completed regional result and its input after contact repair. */
export class Pipeline9DrcCandidateSelectionSolver extends BaseSolver {
  private readonly candidates: HighDensityRoute[][]
  private nextCandidateIndex = 0
  private bestCandidate?: ValidatedCandidate

  constructor(readonly params: Pipeline9DrcCandidateSelectionParams) {
    super()
    this.candidates = [params.regionalRoutes]
    if (
      JSON.stringify(params.regionalRoutes) !==
      JSON.stringify(params.preRegionalRoutes)
    ) {
      this.candidates.push(params.preRegionalRoutes)
    }
  }

  override getConstructorParams(): [Pipeline9DrcCandidateSelectionParams] {
    return [this.params]
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || !this.bestCandidate) {
      throw new Error("Pipeline9 DRC candidate selection requires a solve")
    }
    return this.bestCandidate.routes
  }

  private considerCandidate(
    routes: HighDensityRoute[],
    repairStats?: Record<string, unknown>,
  ): void {
    const errors = getPipeline9DrcErrors(
      this.params.referenceDrcEvaluator,
      routes,
    )
    if (
      !this.bestCandidate ||
      isPipeline9DrcPriorityImprovement({
        currentErrors: this.bestCandidate.errors,
        candidateErrors: errors,
      })
    ) {
      this.bestCandidate = { routes, errors }
      this.stats = {
        ...repairStats,
        finalDrcIssueCount: errors.length,
      }
    }
    this.solved =
      errors.length === 0 || this.nextCandidateIndex === this.candidates.length
    this.progress = this.solved
      ? 1
      : this.nextCandidateIndex / this.candidates.length
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
      if (this.params.contactGuard.getNewContactPairs(routes).length > 0) {
        throw new Error("Pipeline9 trace contact repair published a new short")
      }
      this.activeSubSolver = null
      this.considerCandidate(routes, repair.stats)
      return
    }

    const routes = this.candidates[this.nextCandidateIndex]
    if (!routes) {
      throw new Error("Pipeline9 DRC selection has no next candidate")
    }
    this.nextCandidateIndex++
    if (this.params.contactGuard.getNewContactPairs(routes).length === 0) {
      this.considerCandidate(routes)
      return
    }

    const contactRepair = new TraceContactRepairSolver({
      ...this.params.contactRepairParams,
      hdRoutes: routes,
      tracePairDrcEvaluator: this.params.referenceDrcEvaluator,
      deferTraceContactGuard: false,
    })
    this.activeSubSolver = contactRepair
    // Account for the active child using its existing iteration limit.
    this.MAX_ITERATIONS = Math.max(
      this.MAX_ITERATIONS,
      this.iterations + contactRepair.MAX_ITERATIONS + 1,
    )
  }
}

import { BaseSolver } from "lib/solvers/BaseSolver"
import {
  getPipeline9BoundedRepairAllowance,
  PIPELINE9_BOUNDED_REPAIR_BUDGET,
  pipeline9BoundedRegionalRepairSteps,
  type Pipeline9BoundedRegionalRepairParams,
  type Pipeline9BoundedRegionalRepairResult,
} from "./applyPipeline9BoundedRegionalRepairs"

/** Advances one regional-generator batch or one projection/merge child step. */
export class Pipeline9BoundedRegionalRepairSolver extends BaseSolver {
  readonly params: Pipeline9BoundedRegionalRepairParams
  private readonly steps: ReturnType<typeof pipeline9BoundedRegionalRepairSteps>
  private currentResult?: Pipeline9BoundedRegionalRepairResult
  private result?: Pipeline9BoundedRegionalRepairResult
  private reservedChildMaximum = 0

  constructor(params: Pipeline9BoundedRegionalRepairParams) {
    super()
    this.params = params
    const budget = params.budget ?? PIPELINE9_BOUNDED_REPAIR_BUDGET
    const pointCount = params.routes.reduce(
      (count, route): number => count + route.route.length,
      0,
    )
    const setupBatchesPerCall =
      Math.ceil(params.originalSrj.obstacles.length / 128) +
      Math.ceil(params.routes.length / 32) +
      Math.ceil(pointCount / 128) +
      32
    // Path expansion yields every 128 nodes, with bounded geometry setup at
    // each call. Child phase limits are reserved when their solvers are yielded.
    this.MAX_ITERATIONS =
      Math.ceil(budget.maxPathSearchNodes / 128) +
      budget.maxCandidateAttempts * setupBatchesPerCall +
      budget.maxRegions * 128 +
      1024
    this.steps = pipeline9BoundedRegionalRepairSteps(params, (result): void => {
      this.currentResult = result
      this.updateProgress()
    })
  }

  private updateProgress(): void {
    const result = this.currentResult
    if (!result) return
    const budget = this.params.budget ?? PIPELINE9_BOUNDED_REPAIR_BUDGET
    const allowance = getPipeline9BoundedRepairAllowance(
      budget,
      result.acceptedRegionCount,
    )
    this.stats = {
      ...result,
      routes: undefined,
      allowedRegionCount: allowance.maxRegions,
      allowedCandidateAttemptCount: allowance.maxCandidateAttempts,
      allowedPathSearchNodeCount: allowance.maxPathSearchNodes,
    }
    const consumed = Math.max(
      result.attemptedRegionCount / Math.max(1, budget.maxRegions),
      result.candidateAttemptCount / Math.max(1, budget.maxCandidateAttempts),
      result.pathSearchNodeCount / Math.max(1, budget.maxPathSearchNodes),
    )
    this.progress = this.solved
      ? 1
      : Math.max(this.progress, Math.min(0.99, consumed))
  }

  override _step(): void {
    const child = this.activeSubSolver
    if (child) {
      child.step()
      if (child.MAX_ITERATIONS > this.reservedChildMaximum) {
        this.MAX_ITERATIONS += child.MAX_ITERATIONS - this.reservedChildMaximum
        this.reservedChildMaximum = child.MAX_ITERATIONS
      }
      if (child.failed) {
        this.failed = true
        this.error = child.error
      } else if (child.solved) {
        this.activeSubSolver = null
        this.reservedChildMaximum = 0
      }
      this.updateProgress()
      return
    }
    const next = this.steps.next()
    if (next.done) {
      this.result = next.value
      this.currentResult = next.value
      this.solved = true
    } else if (next.value) {
      this.activeSubSolver = next.value
      this.reservedChildMaximum = next.value.MAX_ITERATIONS
      this.MAX_ITERATIONS += this.reservedChildMaximum + 1
    }
    this.updateProgress()
  }

  getResult(): Pipeline9BoundedRegionalRepairResult {
    if (!this.solved || this.failed || !this.result) {
      throw new Error(
        "Pipeline9 bounded regional repair result requested before completion",
      )
    }
    return this.result
  }
}

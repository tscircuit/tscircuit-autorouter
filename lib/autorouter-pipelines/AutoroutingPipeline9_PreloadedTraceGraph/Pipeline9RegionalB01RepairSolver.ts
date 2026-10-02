import { BaseSolver } from "lib/solvers/BaseSolver"
import {
  generatePipeline9RegionalB01RepairSteps,
  getPipeline9RegionalRepairSearchBudget,
  type Pipeline9RegionalB01ChildSolver,
  type Pipeline9RegionalB01RepairParams,
  type Pipeline9RegionalB01RepairResult,
} from "./applyPipeline9RegionalB01Repairs"

/** Advances regional routing by one child step without draining its searches. */
export class Pipeline9RegionalB01RepairSolver extends BaseSolver {
  readonly params: Pipeline9RegionalB01RepairParams
  result?: Pipeline9RegionalB01RepairResult
  private readonly candidateSearchBudget: number
  private lastChildSolver?: Pipeline9RegionalB01ChildSolver
  private startedChildCount = 0
  private readonly repairSteps: Generator<
    Pipeline9RegionalB01ChildSolver,
    Pipeline9RegionalB01RepairResult,
    void
  >

  constructor(params: Pipeline9RegionalB01RepairParams) {
    super()
    this.params = params
    this.candidateSearchBudget = getPipeline9RegionalRepairSearchBudget(
      params.routes.length,
    )
    // Each child contributes its existing iteration limit when it starts;
    // reserve one additional step to consume the generator's final result.
    this.MAX_ITERATIONS = 1
    this.repairSteps = generatePipeline9RegionalB01RepairSteps(params)
  }

  override _step(): void {
    const next = this.repairSteps.next()
    if (!next.done) {
      if (next.value !== this.lastChildSolver) {
        const childStepBudget = Math.floor(next.value.MAX_ITERATIONS) + 1
        if (!Number.isSafeInteger(childStepBudget) || childStepBudget < 1) {
          throw new Error("Regional B01 child has an invalid iteration limit")
        }
        this.MAX_ITERATIONS += childStepBudget
        this.lastChildSolver = next.value
        this.startedChildCount++
      }
      this.activeSubSolver = next.value
      return
    }
    this.result = next.value
    this.activeSubSolver = null
    this.lastChildSolver = undefined
    this.stats = { ...next.value, routes: undefined }
    this.solved = true
  }

  computeProgress(): number {
    if (this.solved) return 1
    if (this.startedChildCount === 0) return 0
    const activeProgress = Math.max(
      0,
      Math.min(1, this.activeSubSolver?.progress ?? 0),
    )
    return Math.max(
      this.progress,
      Math.min(
        1,
        (this.startedChildCount - 1 + activeProgress) /
          (this.candidateSearchBudget + 1),
      ),
    )
  }

  getResult(): Pipeline9RegionalB01RepairResult {
    if (!this.solved || this.failed || !this.result) {
      throw new Error("Pipeline9 regional B01 repair is not complete")
    }
    return this.result
  }
}

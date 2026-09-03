import { BaseSolver } from "./BaseSolver"

/** Progress reporting for the autorouters that use currentPipelineStepIndex. */
export abstract class BasePipelineSolver extends BaseSolver {
  abstract pipelineDef: readonly unknown[]
  abstract currentPipelineStepIndex: number

  /**
   * Give each stage equal weight, including partial progress in the active
   * stage. This measures pipeline completion, not estimated time remaining.
   */
  computeProgress(): number {
    if (this.solved) return 1
    if (this.failed) return this.progress
    if (this.pipelineDef.length === 0) return 0

    const stageProgress = Math.max(
      0,
      Math.min(1, this.activeSubSolver?.progress ?? 0),
    )
    const pipelineProgress =
      (this.currentPipelineStepIndex + stageProgress) / this.pipelineDef.length

    // A stage can restart its search or switch strategies. Preserve the best
    // reported progress while that stage catches up.
    return Math.max(this.progress, Math.min(1, pipelineProgress))
  }
}

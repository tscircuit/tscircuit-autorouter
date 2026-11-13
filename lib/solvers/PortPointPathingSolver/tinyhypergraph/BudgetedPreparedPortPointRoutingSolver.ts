import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"

export class BudgetedPreparedPortPointRoutingSolver extends PreparedPortPointRoutingSolver {
  baselineIterationLimit = 0

  override getSolverName(): string {
    return PreparedPortPointRoutingSolver.name
  }

  override _step(): void {
    super._step()
    if (
      this.solved ||
      this.failed ||
      this.iterations !== this.baselineIterationLimit
    )
      return

    // Use the original budget for the existing final-route acceptance check.
    // A valid baseline solution finishes here. An incomplete search continues.
    const extendedLimit = this.MAX_ITERATIONS
    this.MAX_ITERATIONS = this.baselineIterationLimit
    try {
      this.tryFinalAcceptance()
    } finally {
      this.MAX_ITERATIONS = extendedLimit
    }
  }
}

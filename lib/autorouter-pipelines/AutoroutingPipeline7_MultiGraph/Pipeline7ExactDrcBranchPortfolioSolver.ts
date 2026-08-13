import {
  GlobalDrcBranchPortfolioSolver,
  type GlobalDrcBranchPortfolioSolverParams,
} from "high-density-repair03/lib"

export type Pipeline7ExactDrcBranchPortfolioSolverParams =
  GlobalDrcBranchPortfolioSolverParams & {
    skipExpensiveBranches?: boolean
    inputDrcIssueCount?: number
  }

/**
 * Keeps exact DRC repair bounded when the global pass leaves a large residue.
 * The branch portfolio is intended for a small number of localized errors;
 * broad repulsion over a heavily violating large board is both costly and
 * unlikely to converge.
 */
export class Pipeline7ExactDrcBranchPortfolioSolver extends GlobalDrcBranchPortfolioSolver {
  private readonly skipExpensiveBranches: boolean
  private readonly inputDrcIssueCount?: number

  constructor(params: Pipeline7ExactDrcBranchPortfolioSolverParams) {
    super(params)
    this.skipExpensiveBranches = params.skipExpensiveBranches ?? false
    this.inputDrcIssueCount = params.inputDrcIssueCount
  }

  override _step() {
    if (!this.skipExpensiveBranches) {
      super._step()
      return
    }

    this.outputHdRoutes = this.inputHdRoutes
    this.stats = {
      exactDrcBranchPortfolioSkipped: true,
      exactDrcBranchPortfolioSkipReason: "high_initial_drc_issue_count",
      exactDrcBranchPortfolioInitialDrcIssueCount: this.inputDrcIssueCount,
    }
    this.progress = 1
    this.solved = true
  }
}

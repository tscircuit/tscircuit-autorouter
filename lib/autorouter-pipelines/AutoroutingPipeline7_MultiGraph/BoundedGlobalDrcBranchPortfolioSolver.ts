import {
  GlobalDrcBranchPortfolioSolver,
  type GlobalDrcBranchPortfolioSolverParams,
} from "high-density-repair03/lib"

const LARGE_BOARD_MIN_ROUTE_COUNT = 500
const MAX_EXACT_DRC_WORK_ESTIMATE = 5_000_000

function getExactDrcWorkEstimate(
  params: GlobalDrcBranchPortfolioSolverParams,
): number {
  const segmentCount = params.hdRoutes.reduce(
    (count, route) => count + Math.max(0, route.route.length - 1),
    0,
  )
  const boardObjectCount = params.hdRoutes.length + params.srj.obstacles.length

  return segmentCount * boardObjectCount
}

/**
 * Exact DRC repair is best-effort after global repair. Avoid repeatedly
 * rescoring oversized boards; the benchmark still independently checks the
 * already repaired routes returned here.
 */
export class BoundedGlobalDrcBranchPortfolioSolver extends GlobalDrcBranchPortfolioSolver {
  readonly exactDrcWorkEstimate: number
  readonly skippedForLargeBoard: boolean

  constructor(params: GlobalDrcBranchPortfolioSolverParams) {
    super(params)
    this.exactDrcWorkEstimate = getExactDrcWorkEstimate(params)
    this.skippedForLargeBoard =
      params.hdRoutes.length >= LARGE_BOARD_MIN_ROUTE_COUNT &&
      this.exactDrcWorkEstimate > MAX_EXACT_DRC_WORK_ESTIMATE
  }

  override _step(): void {
    if (!this.skippedForLargeBoard) {
      super._step()
      return
    }

    this.outputHdRoutes = this.inputHdRoutes
    this.activeSubSolver = null
    this.progress = 1
    this.stats = {
      exactDrcBranchPortfolioSkippedForLargeBoard: true,
      exactDrcBranchPortfolioWorkEstimate: this.exactDrcWorkEstimate,
      exactDrcBranchPortfolioRouteCount: this.inputHdRoutes.length,
    }
    this.solved = true
  }
}

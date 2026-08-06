import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"

export const getTinyHyperGraphSolveGraphContinuationMaxIterations = ({
  initialMaxIterations,
}: {
  initialMaxIterations: number
  connectionCount: number
}): number => initialMaxIterations

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private readonly initialMaxIterations: number
  private continuationBudgetGranted = false

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.initialMaxIterations = this.MAX_ITERATIONS
  }

  override tryFinalAcceptance() {
    super.tryFinalAcceptance()
    if (this.solved || this.continuationBudgetGranted) return

    const continuationMaxIterations =
      getTinyHyperGraphSolveGraphContinuationMaxIterations({
        initialMaxIterations: this.initialMaxIterations,
        connectionCount: this.problem.routeCount,
      })
    if (continuationMaxIterations <= this.MAX_ITERATIONS) return

    this.MAX_ITERATIONS = continuationMaxIterations
    this.continuationBudgetGranted = true
    this.stats = {
      ...this.stats,
      initialMaxIterations: this.initialMaxIterations,
      continuationMaxIterations,
    }
  }

  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    if (!this.problem.initialAssignments?.length) return

    applyInitialAssignments({
      topology: this.topology,
      problem: this.problem,
      state: this.state,
      routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
      appendSegmentToRegionCache: (regionId, fromPortId, toPortId) =>
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId),
    })
  }
}

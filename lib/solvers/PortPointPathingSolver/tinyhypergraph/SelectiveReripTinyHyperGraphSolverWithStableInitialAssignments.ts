import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"

const BASE_SOLVE_GRAPH_ITERATIONS = 2_000_000
const CONTINUATION_ITERATIONS_PER_CONNECTION = 32_000

export const getTinyHyperGraphSolveGraphContinuationMaxIterations = ({
  initialMaxIterations,
  connectionCount,
}: {
  initialMaxIterations: number
  connectionCount: number
}): number => {
  const effortScale = initialMaxIterations / BASE_SOLVE_GRAPH_ITERATIONS
  return Math.max(
    initialMaxIterations,
    Math.ceil(
      connectionCount * CONTINUATION_ITERATIONS_PER_CONNECTION * effortScale,
    ),
  )
}

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
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

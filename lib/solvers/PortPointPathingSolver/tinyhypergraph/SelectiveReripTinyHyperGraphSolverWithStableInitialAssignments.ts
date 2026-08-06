import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
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
  private readonly initialMaxIterations: number
  private continuationBudgetGranted = false
  private lastLoggedMillionIterations = 0

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

  override _step() {
    super._step()
    if (this.problem.routeCount < 800) return

    const millionIterations = Math.floor(this.iterations / 1_000_000)
    if (millionIterations <= this.lastLoggedMillionIterations) return
    this.lastLoggedMillionIterations = millionIterations
    const neverRoutedRouteCount = this.routeSuccessCountByRouteId.reduce(
      (count, successCount) => count + (successCount === 0 ? 1 : 0),
      0,
    )
    console.error(
      "[tiny-large-graph-progress]",
      JSON.stringify({
        iterations: this.iterations,
        maxIterations: this.MAX_ITERATIONS,
        unroutedRouteCount: this.state.unroutedRoutes.length,
        neverRoutedRouteCount,
        ripCount: this.state.ripCount,
        regionPathGuidedRouteCount:
          this.stats.regionPathGuidedRouteCount,
        regionPathFallbackRouteCount:
          this.stats.regionPathFallbackRouteCount,
        regionPathPlanningIterations:
          this.stats.regionPathPlanningIterations,
        regionPathPlanningSolved: this.stats.regionPathPlanningSolved,
        regionPathPlanningSolvedRouteCount:
          this.stats.regionPathPlanningSolvedRouteCount,
      }),
    )
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

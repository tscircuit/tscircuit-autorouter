import {
  type Candidate,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
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

  override onPathFound(finalCandidate: Candidate): void {
    const goalPortId = this.state.goalPortId
    if (finalCandidate.portId === goalPortId) {
      TinyHyperGraphSolver.prototype.onPathFound.call(this, finalCandidate)
      return
    }

    const g = this.computeG(finalCandidate, goalPortId)
    if (!Number.isFinite(g)) return

    TinyHyperGraphSolver.prototype.onPathFound.call(this, {
      prevRegionId: finalCandidate.nextRegionId,
      nextRegionId: finalCandidate.nextRegionId,
      portId: goalPortId,
      g,
      h: 0,
      f: g,
      prevCandidate: finalCandidate,
    })
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

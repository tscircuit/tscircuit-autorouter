import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"

const MAX_RETRY_SEARCH_ITERATIONS = 50_000

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private searchRouteId?: number
  private searchIterations = 0

  override _step() {
    const routeId = this.state.currentRouteId
    if (routeId === undefined) {
      this.resetSearchCounter()
      super._step()
      return
    }

    if (routeId !== this.searchRouteId) {
      this.searchRouteId = routeId
      this.searchIterations = 0
    }
    this.searchIterations++

    if (
      this.routeAttemptCountByRouteId[routeId]! > 1 &&
      this.searchIterations >= MAX_RETRY_SEARCH_ITERATIONS
    ) {
      this.state.candidateQueue.clear()
      this.resetSearchCounter()
    }

    super._step()
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

  private resetSearchCounter() {
    this.searchRouteId = undefined
    this.searchIterations = 0
  }
}

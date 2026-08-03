import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private routeSearchRouteId?: number
  private routeSearchIterations = 0

  override _step() {
    const routeId = this.state.currentRouteId
    if (routeId === undefined) {
      this.resetRouteSearchBudget()
      super._step()
      return
    }

    if (routeId !== this.routeSearchRouteId) {
      this.routeSearchRouteId = routeId
      this.routeSearchIterations = 0
    }
    this.routeSearchIterations++

    const maxRouteSearchIterations = Math.max(
      1_000,
      Math.floor(this.MAX_ITERATIONS / this.problem.routeCount / 2),
    )
    if (this.routeSearchIterations >= maxRouteSearchIterations) {
      this.state.candidateQueue.clear()
      this.resetRouteSearchBudget()
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

  private resetRouteSearchBudget() {
    this.routeSearchRouteId = undefined
    this.routeSearchIterations = 0
  }
}

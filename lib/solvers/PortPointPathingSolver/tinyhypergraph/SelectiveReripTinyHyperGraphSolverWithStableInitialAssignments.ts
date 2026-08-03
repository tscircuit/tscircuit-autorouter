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
      if (this.commitClearRelaxedPath()) {
        this.resetRouteSearchBudget()
        return
      }
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

  private commitClearRelaxedPath(): boolean {
    const routeId = this.state.currentRouteId
    const routeNetId = this.state.currentRouteNetId
    if (routeId === undefined || routeNetId === undefined) return false

    const path = this.findRelaxedBlockerPath()
    if (!path.found || path.owners.size > 0) return false

    this.routeSuccessCountByRouteId[routeId] += 1
    for (let i = 1; i < path.states.length; i++) {
      const previousState = path.states[i - 1]!
      const currentState = path.states[i]!
      const regionId = previousState.nextRegionId
      const fromPortId = previousState.portId
      const toPortId = currentState.portId

      this.state.regionSegments[regionId].push([
        routeId,
        fromPortId,
        toPortId,
      ])
      this.state.portAssignment[fromPortId] = routeNetId
      this.state.portAssignment[toPortId] = routeNetId
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }

    this.state.candidateQueue.clear()
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    return true
  }

  private resetRouteSearchBudget() {
    this.routeSearchRouteId = undefined
    this.routeSearchIterations = 0
  }
}

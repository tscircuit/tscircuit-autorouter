import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private initialAssignmentRouteIds?: ReadonlySet<number>

  protected override getRouteIdsPreferredForPreservation(): ReadonlySet<number> {
    if (!this.initialAssignmentRouteIds) {
      this.initialAssignmentRouteIds = new Set(
        (this.problem.initialAssignments ?? []).map(
          (assignment) => assignment.routeId,
        ),
      )
    }
    return this.initialAssignmentRouteIds
  }

  override resetRoutingStateForRerip(): void {
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

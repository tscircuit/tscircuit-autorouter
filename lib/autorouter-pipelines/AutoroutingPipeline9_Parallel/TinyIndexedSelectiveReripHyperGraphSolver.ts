import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import { SelectiveReripTinyHyperGraphSolver } from "./tiny-hypergraph-fork/SelectiveReripTinyHyperGraphSolver"

/** Native candidate scoring with one-pass partial-rip segment preparation. */
export class TinyIndexedSelectiveReripHyperGraphSolver extends SelectiveReripTinyHyperGraphSolver {
  private initialAssignmentRouteIds?: ReadonlySet<number>

  protected override getRouteIdsPreferredForPreservation(): ReadonlySet<number> {
    if (!this.initialAssignmentRouteIds) {
      this.initialAssignmentRouteIds = new Set(
        (this.problem.initialAssignments ?? []).map((assignment) => assignment.routeId),
      )
    }
    return this.initialAssignmentRouteIds
  }

  override resetRoutingStateForRerip(): void {
    super.resetRoutingStateForRerip()
    if (!this.problem.initialAssignments?.length) return
    applyInitialAssignments({
      topology: this.topology, problem: this.problem, state: this.state,
      routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
      appendSegmentToRegionCache: (regionId, fromPortId, toPortId) =>
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId),
    })
  }
}

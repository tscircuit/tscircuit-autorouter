import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import type { IndependentRouteSegment } from "./DuplicateCongestedPortSolverWithIndependentRoutes"
import { initializePlanarBoundarySeed } from "./initializePlanarBoundarySeed"

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private initialAssignmentRouteIds?: ReadonlySet<number>
  private initialBackboneSegments?: readonly IndependentRouteSegment[]
  private initialBackboneSetupDone = false

  setInitialBackboneSegments(segments: readonly IndependentRouteSegment[]): void {
    if (this.initialBackboneSetupDone || this.iterations !== 0) {
      throw new Error("Initial backbone segments must be queued before setup")
    }
    if (this.initialBackboneSegments) {
      throw new Error("Initial backbone segments have already been queued")
    }
    this.initialBackboneSegments = segments
  }

  override _setup(): void {
    super._setup()
    this.initialBackboneSetupDone = true
    const segments = this.initialBackboneSegments
    this.initialBackboneSegments = undefined
    if (this.failed || !this.PARTIAL_RIP_ENABLED || !segments) return

    initializePlanarBoundarySeed(
      this,
      segments,
      this.routeSuccessCountByRouteId,
    )
  }

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

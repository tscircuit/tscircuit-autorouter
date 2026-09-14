import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import type { TinyHyperGraphWorkingState } from "tiny-hypergraph/lib/core"

type PartialRoutingSnapshot = {
  snapshot: Pick<
    TinyHyperGraphWorkingState,
    | "portAssignment"
    | "regionSegments"
    | "regionIntersectionCaches"
    | "regionCongestionCost"
    | "ripCount"
  >
  remainingRouteIds: number[]
}

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private initialAssignmentRouteIds?: ReadonlySet<number>
  private bestPartialRoutingSnapshot?: PartialRoutingSnapshot

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

  private preservePartialRoutingState(): void {
    // Capture between searches, after selective ripping has released blockers.
    // A state whose active route exhausted its candidates is already blocked.
    if (this.state.currentRouteId !== undefined) return
    const remainingRouteIds = this.getRemainingRouteIdsForGreedyFinalRoute()
    if (
      remainingRouteIds.length > 0 &&
      remainingRouteIds.length <
        (this.bestPartialRoutingSnapshot?.remainingRouteIds.length ??
          this.problem.routeCount)
    ) {
      this.bestPartialRoutingSnapshot = {
        snapshot: structuredClone({
          portAssignment: this.state.portAssignment,
          regionSegments: this.state.regionSegments,
          regionIntersectionCaches: this.state.regionIntersectionCaches,
          regionCongestionCost: this.state.regionCongestionCost,
          ripCount: this.state.ripCount,
        }),
        remainingRouteIds,
      }
      this.stats.bestPartialUnroutedRouteCount = remainingRouteIds.length
    }
  }

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    if (!this.failed && !this.solved) {
      this.preservePartialRoutingState()
    }
  }

  override resetRoutingStateForRerip(): void {
    this.preservePartialRoutingState()
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

  protected override tryGreedyFinalRouteAcceptance(): boolean {
    const remainingRouteIds = this.getRemainingRouteIdsForGreedyFinalRoute()
    const partial = this.bestPartialRoutingSnapshot
    if (
      partial &&
      partial.remainingRouteIds.length < remainingRouteIds.length
    ) {
      const ripCount = this.state.ripCount
      this.applySnapshotToGreedyFinalRouteSolver(
        this,
        partial.snapshot,
        partial.remainingRouteIds,
      )
      this.state.ripCount = ripCount
      this.stats.greedyFinalRouteRestoredPartialState = true
      this.stats.greedyFinalRoutePreviousRemainingRouteCount =
        remainingRouteIds.length
    }
    return super.tryGreedyFinalRouteAcceptance()
  }
}

import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import type { TinyHyperGraphWorkingState } from "tiny-hypergraph/lib/core"
import { routingDiagnostics } from "../../routingDiagnostics"

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
    const currentRouteId = this.state.currentRouteId
    if (currentRouteId === undefined) return this.initialAssignmentRouteIds

    const failedOwnerPairs = this.getSelectiveReripStats().failedOwnerPairs
    const dependentRouteIds = new Set<number>([currentRouteId])
    const pendingRouteIds = [currentRouteId]
    while (pendingRouteIds.length > 0) {
      const ownerRouteId = pendingRouteIds.pop()!
      for (const pair of failedOwnerPairs) {
        if (
          pair.ownerRouteId !== ownerRouteId ||
          dependentRouteIds.has(pair.failedRouteId)
        )
          continue
        dependentRouteIds.add(pair.failedRouteId)
        pendingRouteIds.push(pair.failedRouteId)
      }
    }
    dependentRouteIds.delete(currentRouteId)
    this.stats.cyclePreservedRouteCount = Math.max(
      Number(this.stats.cyclePreservedRouteCount ?? 0),
      dependentRouteIds.size,
    )
    // If A already displaced B, prefer a different blocker when B is retried.
    // The existing preservation-aware search can find an alternate owner before
    // the ordinary cycle detector has to discard all committed routing.
    return new Set([...this.initialAssignmentRouteIds, ...dependentRouteIds])
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
    routingDiagnostics.emit?.({
      kind: "pathing_blocker_search_start",
      routeId: this.state.currentRouteId,
      remainingRouteCount: this.state.unroutedRoutes.length + 1,
      iterations: this.iterations,
      selectiveRerip: this.getSelectiveReripStats(),
    })
    super.onOutOfCandidates()
    if (!this.failed && !this.solved) {
      this.preservePartialRoutingState()
    }
    routingDiagnostics.emit?.({
      kind: "pathing_blocker_search_end",
      remainingRouteCount: this.state.unroutedRoutes.length,
      iterations: this.iterations,
      selectiveRerip: this.getSelectiveReripStats(),
    })
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

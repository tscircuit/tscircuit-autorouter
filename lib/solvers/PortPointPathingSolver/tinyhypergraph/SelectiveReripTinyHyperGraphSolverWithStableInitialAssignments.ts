import {
  type Candidate,
  SelectiveReripTinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"
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

/**
 * A feasibility pass for routes whose terminals already share a layer.
 *
 * Preloaded trace sections are left alone, while new routes are prevented from
 * changing layers. The caller falls back to the unrestricted solver if this
 * constrained pass cannot route the complete graph.
 */
export class SameLayerFirstTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  override computeG(
    currentCandidate: Candidate,
    neighborPortId: number,
    maximumCost?: number,
    knownSegmentDistance?: number,
  ): number {
    const routeId = this.state.currentRouteId
    if (routeId !== undefined) {
      const routeMetadata = this.problem.routeMetadata?.[routeId]
      const isPreloadedTrace =
        routeMetadata?.preloadedTraceSection !== undefined
      const startPortId = this.problem.routeStartPort[routeId]
      const endPortId = this.problem.routeEndPort[routeId]
      const startZ = this.topology.portZ[startPortId]
      const endZ = this.topology.portZ[endPortId]

      if (
        !isPreloadedTrace &&
        startZ === endZ &&
        (this.topology.portZ[currentCandidate.portId] !== startZ ||
          this.topology.portZ[neighborPortId] !== startZ)
      ) {
        return Number.POSITIVE_INFINITY
      }
    }

    return super.computeG(
      currentCandidate,
      neighborPortId,
      maximumCost,
      knownSegmentDistance,
    )
  }
}

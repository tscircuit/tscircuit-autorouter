import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private reripEvents: Array<{
    iteration: number
    failedRouteId?: number
    selectiveRipCount: number
    globalReripCount: number
    unroutedRouteCount: number
  }> = []

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

  override onOutOfCandidates() {
    const failedRouteId = this.state.currentRouteId
    const before = this.getSelectiveReripStats()
    super.onOutOfCandidates()
    const after = this.getSelectiveReripStats()

    if (
      after.selectiveRipCount !== before.selectiveRipCount ||
      after.globalReripCount !== before.globalReripCount
    ) {
      this.reripEvents.push({
        iteration: this.iterations,
        failedRouteId,
        selectiveRipCount: after.selectiveRipCount,
        globalReripCount: after.globalReripCount,
        unroutedRouteCount: this.state.unroutedRoutes.length,
      })
    }
  }

  override tryFinalAcceptance() {
    super.tryFinalAcceptance()
    if (this.solved) return

    const stats = this.getSelectiveReripStats()
    const routeIds = [
      stats.lastFailedRouteId,
      ...stats.lastDirectOwnerRouteIds,
      ...stats.lastRepeatedOwnerRouteIds,
      ...stats.lastAlternateOwnerRouteIds,
      ...stats.lastRippedRouteIds,
      this.state.currentRouteId,
      ...this.state.unroutedRoutes.slice(0, 3),
      ...this.state.unroutedRoutes.slice(-3),
    ].filter(
      (routeId, index, routeIdList): routeId is number =>
        routeId !== undefined && routeIdList.indexOf(routeId) === index,
    )

    throw new Error(
      `Selective rerip exhausted: ${JSON.stringify({
        ...stats,
        iterations: this.iterations,
        maxIterations: this.MAX_ITERATIONS,
        reripEvents: this.reripEvents,
        currentRouteId: this.state.currentRouteId,
        unroutedRouteCount: this.state.unroutedRoutes.length,
        routes: routeIds.map((routeId) => ({
          routeId,
          attemptCount: this.routeAttemptCountByRouteId[routeId],
          successCount: this.routeSuccessCountByRouteId[routeId],
          metadata: this.problem.routeMetadata?.[routeId],
          startPort: this.describePort(this.problem.routeStartPort[routeId]!),
          endPort: this.describePort(this.problem.routeEndPort[routeId]!),
          committedSegments: this.state.regionSegments.flatMap(
            (segments, regionId) =>
              segments
                .filter(([ownerRouteId]) => ownerRouteId === routeId)
                .map(([, fromPortId, toPortId]) => ({
                  regionId,
                  fromPortId,
                  toPortId,
                })),
          ),
        })),
      })}`,
    )
  }

  private describePort(portId: number) {
    return {
      portId,
      x: this.topology.portX[portId],
      y: this.topology.portY[portId],
      z: this.topology.portZ[portId],
      assignment: this.state.portAssignment[portId],
      incidentRegions: (this.topology.incidentPortRegion[portId] ?? []).map(
        (regionId) => ({
          regionId,
          x: this.topology.regionCenterX[regionId],
          y: this.topology.regionCenterY[regionId],
          width: this.topology.regionWidth[regionId],
          height: this.topology.regionHeight[regionId],
          availableZMask: this.topology.regionAvailableZMask?.[regionId],
          netId: this.problem.regionNetId[regionId],
          metadata: this.topology.regionMetadata?.[regionId],
        }),
      ),
      metadata: this.topology.portMetadata?.[portId],
    }
  }
}

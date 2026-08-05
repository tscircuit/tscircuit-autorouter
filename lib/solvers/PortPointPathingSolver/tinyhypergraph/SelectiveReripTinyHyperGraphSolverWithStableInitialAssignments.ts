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

  override _setup() {
    super._setup()
    if (this.failed) return

    const unreachableRoutes = []
    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const reachability = this.describeFixedReservationReachability(routeId)
      if (reachability.found) continue
      unreachableRoutes.push({
        routeId,
        routeMetadata: this.problem.routeMetadata?.[routeId],
        startPort: this.describePort(this.problem.routeStartPort[routeId]!),
        endPort: this.describePort(this.problem.routeEndPort[routeId]!),
        reachability,
      })
    }

    throw new Error(
      `Fixed reservation precheck: ${JSON.stringify({
        unreachableRouteCount: unreachableRoutes.length,
        unreachableRoutes: unreachableRoutes.slice(0, 25),
      })}`,
    )
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

  override onOutOfCandidates() {
    const failedRouteId = this.state.currentRouteId
    const before = this.getSelectiveReripStats()
    const fixedReservationReachability =
      failedRouteId === undefined
        ? undefined
        : this.describeFixedReservationReachability(failedRouteId)
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

    if (after.globalReripCount !== before.globalReripCount) {
      throw new Error(
        `Global rerip diagnostic: ${JSON.stringify({
          failedRouteId,
          routeMetadata:
            failedRouteId === undefined
              ? undefined
              : this.problem.routeMetadata?.[failedRouteId],
          startPort:
            failedRouteId === undefined
              ? undefined
              : this.describePort(this.problem.routeStartPort[failedRouteId]!),
          endPort:
            failedRouteId === undefined
              ? undefined
              : this.describePort(this.problem.routeEndPort[failedRouteId]!),
          globalReripReason: after.globalReripReason,
          fixedReservationReachability,
        })}`,
      )
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

  private describeFixedReservationReachability(routeId: number) {
    const routeNetId = this.problem.routeNet[routeId]!
    const startPortId = this.problem.routeStartPort[routeId]!
    const goalPortId = this.problem.routeEndPort[routeId]!
    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)
    const blockedRegionIds = new Set<number>()
    const blockedPortIds = new Set<number>()
    const outsideSectionPortIds = new Set<number>()
    const deadEndPortIds = new Set<number>()
    const reachedRegionIds = new Set<number>()
    const reachedPortIds = new Set<number>()

    if (startRegionId === undefined) {
      return { found: false, reason: "no_start_region" }
    }

    const queue = [{ portId: startPortId, nextRegionId: startRegionId }]
    const seenHopIds = new Set<number>([
      this.getHopId(startPortId, startRegionId),
    ])
    let found = false

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const { portId, nextRegionId } = queue[queueIndex]!
      const regionNetId = this.problem.regionNetId[nextRegionId]!
      if (regionNetId !== -1 && regionNetId !== routeNetId) {
        blockedRegionIds.add(nextRegionId)
        continue
      }

      reachedRegionIds.add(nextRegionId)
      reachedPortIds.add(portId)
      for (const neighborPortId of this.topology.regionIncidentPorts[
        nextRegionId
      ] ?? []) {
        const endpointNetIds =
          this.problemSetup.portEndpointNetIds[neighborPortId] ?? []
        if ([...endpointNetIds].some((netId) => netId !== routeNetId)) {
          blockedPortIds.add(neighborPortId)
          continue
        }
        if (neighborPortId === goalPortId) {
          found = true
          break
        }
        if (neighborPortId === portId) continue
        if (this.problem.portSectionMask[neighborPortId] === 0) {
          outsideSectionPortIds.add(neighborPortId)
          continue
        }

        const incidentRegions =
          this.topology.incidentPortRegion[neighborPortId] ?? []
        const followingRegionId =
          incidentRegions[0] === nextRegionId
            ? incidentRegions[1]
            : incidentRegions[0]
        if (followingRegionId === undefined) {
          deadEndPortIds.add(neighborPortId)
          continue
        }

        const followingRegionNetId =
          this.problem.regionNetId[followingRegionId]!
        if (
          followingRegionNetId !== -1 &&
          followingRegionNetId !== routeNetId
        ) {
          blockedRegionIds.add(followingRegionId)
          continue
        }

        const hopId = this.getHopId(neighborPortId, followingRegionId)
        if (seenHopIds.has(hopId)) continue
        seenHopIds.add(hopId)
        queue.push({ portId: neighborPortId, nextRegionId: followingRegionId })
      }
      if (found) break
    }

    const describeRegion = (regionId: number) => ({
      regionId,
      netId: this.problem.regionNetId[regionId],
      center: {
        x: this.topology.regionCenterX[regionId],
        y: this.topology.regionCenterY[regionId],
      },
      width: this.topology.regionWidth[regionId],
      height: this.topology.regionHeight[regionId],
      availableZMask: this.topology.regionAvailableZMask?.[regionId],
      metadata: this.topology.regionMetadata?.[regionId],
    })
    const describeBlockedPort = (portId: number) => ({
      portId,
      endpointNetIds: [
        ...(this.problemSetup.portEndpointNetIds[portId] ?? []),
      ],
      metadata: this.topology.portMetadata?.[portId],
    })

    return {
      found,
      reachedRegionCount: reachedRegionIds.size,
      reachedRegions: [...reachedRegionIds].slice(0, 50).map(describeRegion),
      reachedPortCount: reachedPortIds.size,
      reachedPorts: [...reachedPortIds]
        .slice(0, 50)
        .map((portId) => this.describePort(portId)),
      blockedRegionCount: blockedRegionIds.size,
      blockedRegions: [...blockedRegionIds].slice(0, 50).map(describeRegion),
      blockedPortCount: blockedPortIds.size,
      blockedPorts: [...blockedPortIds].slice(0, 50).map(describeBlockedPort),
      outsideSectionPortCount: outsideSectionPortIds.size,
      outsideSectionPorts: [...outsideSectionPortIds]
        .slice(0, 50)
        .map((portId) => this.describePort(portId)),
      deadEndPortCount: deadEndPortIds.size,
      deadEndPorts: [...deadEndPortIds]
        .slice(0, 50)
        .map((portId) => this.describePort(portId)),
    }
  }
}

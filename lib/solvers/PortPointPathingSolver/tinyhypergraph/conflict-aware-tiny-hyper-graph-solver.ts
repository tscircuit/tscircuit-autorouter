import {
  createEmptyRegionIntersectionCache,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"
import type { PortId, RegionId, RouteId } from "tiny-hypergraph/lib/types"
import { CostConsistentTinyHyperGraphSolver } from "./cost-consistent-tiny-hypergraph-solver"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerSearchResult,
} from "./find-distinct-owner-blocker-path"

type RelaxedSearchState = {
  portId: PortId
  nextRegionId: RegionId
}

type PortBlockerResource = {
  kind: "port"
  portId: PortId
  owners: RouteId[]
}

type CrossingBlockerResource = {
  kind: "crossing"
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
  owners: RouteId[]
}

export type ConflictAwareBlockerResource =
  | PortBlockerResource
  | CrossingBlockerResource

type RelaxedSearchHopData = {
  resources: ConflictAwareBlockerResource[]
}

export type FailedOwnerPairCount = {
  failedRouteId: RouteId
  ownerRouteId: RouteId
  count: number
}

export type ConflictAwareTinyHyperGraphStats = {
  selectiveRipCount: number
  selectivelyRippedRouteCount: number
  strictCrossingRejectedPathCount: number
  alternateBlockerSearchCount: number
  alternateOwnerCount: number
  failedOwnerPairCount: number
  maxFailedOwnerPairCount: number
  failedOwnerPairs: FailedOwnerPairCount[]
  lastFailedRouteId?: RouteId
  lastDirectOwnerRouteIds: RouteId[]
  lastRepeatedOwnerRouteIds: RouteId[]
  lastAlternateOwnerRouteIds: RouteId[]
  lastRippedRouteIds: RouteId[]
  lastRelaxedSearchExpandedLabelCount: number
  lastAlternateSearchExpandedLabelCount: number
}

const createInitialConflictStats = (): ConflictAwareTinyHyperGraphStats => ({
  selectiveRipCount: 0,
  selectivelyRippedRouteCount: 0,
  strictCrossingRejectedPathCount: 0,
  alternateBlockerSearchCount: 0,
  alternateOwnerCount: 0,
  failedOwnerPairCount: 0,
  maxFailedOwnerPairCount: 0,
  failedOwnerPairs: [],
  lastDirectOwnerRouteIds: [],
  lastRepeatedOwnerRouteIds: [],
  lastAlternateOwnerRouteIds: [],
  lastRippedRouteIds: [],
  lastRelaxedSearchExpandedLabelCount: 0,
  lastAlternateSearchExpandedLabelCount: 0,
})

export function selectConflictOwnerRouteIdsToRip(params: {
  failedRouteId: RouteId
  directOwnerRouteIds: readonly RouteId[]
  alternateOwnerRouteIds?: readonly RouteId[]
}): Set<RouteId> {
  if (
    params.alternateOwnerRouteIds !== undefined &&
    params.alternateOwnerRouteIds.length === 0
  ) {
    throw new Error(
      `ConflictAwareTinyHyperGraphSolver: repeated-owner-avoiding search for route ${params.failedRouteId} found a blocker-free path despite strict candidate exhaustion`,
    )
  }

  const rippedRouteIds = new Set<RouteId>(
    params.alternateOwnerRouteIds ?? params.directOwnerRouteIds,
  )
  rippedRouteIds.delete(params.failedRouteId)
  if (rippedRouteIds.size === 0) {
    throw new Error(
      `ConflictAwareTinyHyperGraphSolver: route ${params.failedRouteId} has blocker resources but no distinct committed owner can be ripped`,
    )
  }

  return rippedRouteIds
}

/**
 * Extends the normal tiny-hypergraph search with selective conflict reripping.
 * A relaxed search identifies the smallest set of committed route owners whose
 * resources prevent the current route from reaching its goal.
 */
export class ConflictAwareTinyHyperGraphSolver extends CostConsistentTinyHyperGraphSolver {
  private readonly failedOwnerPairCounts = new Map<
    RouteId,
    Map<RouteId, number>
  >()

  private readonly conflictStats = createInitialConflictStats()

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
  }

  getConflictAwareStats(): ConflictAwareTinyHyperGraphStats {
    return {
      ...this.conflictStats,
      failedOwnerPairs: this.conflictStats.failedOwnerPairs.map((pair) => ({
        ...pair,
      })),
      lastDirectOwnerRouteIds: [...this.conflictStats.lastDirectOwnerRouteIds],
      lastRepeatedOwnerRouteIds: [
        ...this.conflictStats.lastRepeatedOwnerRouteIds,
      ],
      lastAlternateOwnerRouteIds: [
        ...this.conflictStats.lastAlternateOwnerRouteIds,
      ],
      lastRippedRouteIds: [...this.conflictStats.lastRippedRouteIds],
    }
  }

  override onPathFound(finalCandidate: Candidate): void {
    const solvedPathSegments = this.getSolvedPathSegments(finalCandidate)
    const crossingOwners = solvedPathSegments.flatMap(
      ({ regionId, fromPortId, toPortId }) =>
        this.getStrictCrossingOwners(regionId, fromPortId, toPortId),
    )

    if (crossingOwners.length > 0) {
      this.conflictStats.strictCrossingRejectedPathCount += 1
      this.publishConflictStats()
      return
    }

    super.onPathFound(finalCandidate)
  }

  override tryFinalAcceptance(): void {
    super.tryFinalAcceptance()
    if (this.solved && !this.failed) {
      this.assertNoStrictCrossNetCrossingsInCommittedState()
    }
  }

  assertNoStrictCrossNetCrossingsInCommittedState(): void {
    for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
      if (!this.isKnownSingleLayerRegion(regionId)) continue
      const segments = this.state.regionSegments[regionId] ?? []
      for (let firstIndex = 0; firstIndex < segments.length; firstIndex++) {
        const first = segments[firstIndex]!
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < segments.length;
          secondIndex++
        ) {
          const second = segments[secondIndex]!
          if (
            this.problem.routeNet[first[0]] === this.problem.routeNet[second[0]]
          ) {
            continue
          }
          if (
            !this.segmentsStrictlyCross(
              regionId,
              first[1],
              first[2],
              second[1],
              second[2],
            )
          ) {
            continue
          }
          throw new Error(
            `ConflictAwareTinyHyperGraphSolver: accepted state contains a strict cross-net crossing in region ${regionId} between routes ${this.describeRoute(first[0])} and ${this.describeRoute(second[0])}`,
          )
        }
      }
    }
  }

  override onOutOfCandidates(): void {
    const failedRouteId = this.state.currentRouteId
    if (failedRouteId === undefined) {
      throw new Error(
        "ConflictAwareTinyHyperGraphSolver: candidate search exhausted without a current route",
      )
    }

    const directPath = this.findRelaxedConflictPath()
    if (!directPath.found) {
      if (directPath.reason === "expansion_limit") {
        throw new Error(
          `ConflictAwareTinyHyperGraphSolver: blocker search for route ${this.describeRoute(failedRouteId)} exceeded its ${this.getRelaxedSearchExpansionLimit()}-label expansion limit`,
        )
      }
      throw new Error(
        `ConflictAwareTinyHyperGraphSolver: route ${this.describeRoute(failedRouteId)} exhausted candidates, but relaxed blocker search found no path (${directPath.reason}, ${directPath.expandedLabelCount} labels expanded)`,
      )
    }
    if (directPath.owners.size === 0) {
      throw new Error(
        `ConflictAwareTinyHyperGraphSolver: route ${this.describeRoute(failedRouteId)} exhausted candidates despite a blocker-free relaxed path`,
      )
    }

    const directOwnerRouteIds = [...directPath.owners]
    const repeatedOwnerRouteIds: RouteId[] = []
    for (const ownerRouteId of directOwnerRouteIds) {
      const count = this.incrementFailedOwnerPair(failedRouteId, ownerRouteId)
      if (count >= 2) repeatedOwnerRouteIds.push(ownerRouteId)
    }

    let alternatePath:
      | DistinctOwnerBlockerSearchResult<
          RelaxedSearchState,
          RouteId,
          RelaxedSearchHopData
        >
      | undefined
    if (repeatedOwnerRouteIds.length > 0) {
      this.conflictStats.alternateBlockerSearchCount += 1
      alternatePath = this.findRelaxedConflictPath(
        new Set(repeatedOwnerRouteIds),
      )
      if (!alternatePath.found && alternatePath.reason === "expansion_limit") {
        throw new Error(
          `ConflictAwareTinyHyperGraphSolver: repeated-owner-avoiding blocker search for route ${this.describeRoute(failedRouteId)} exceeded its ${this.getRelaxedSearchExpansionLimit()}-label expansion limit`,
        )
      }
    }

    const alternatePathOwnerRouteIds = alternatePath?.found
      ? [...alternatePath.owners]
      : undefined
    const rippedRouteIds = selectConflictOwnerRouteIdsToRip({
      failedRouteId,
      directOwnerRouteIds,
      alternateOwnerRouteIds: alternatePathOwnerRouteIds,
    })

    const alternateOwnerRouteIds = alternatePathOwnerRouteIds
      ? alternatePathOwnerRouteIds.filter(
          (ownerRouteId) => !directPath.owners.has(ownerRouteId),
        )
      : []
    const remainingRouteIds = this.state.unroutedRoutes.filter(
      (routeId) => routeId !== failedRouteId && !rippedRouteIds.has(routeId),
    )

    this.rebuildCommittedState(rippedRouteIds)
    this.state.ripCount += 1
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = [
      failedRouteId,
      ...rippedRouteIds,
      ...remainingRouteIds,
    ]
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1

    this.conflictStats.selectiveRipCount += 1
    this.conflictStats.selectivelyRippedRouteCount += rippedRouteIds.size
    this.conflictStats.alternateOwnerCount += alternateOwnerRouteIds.length
    this.conflictStats.lastFailedRouteId = failedRouteId
    this.conflictStats.lastDirectOwnerRouteIds = directOwnerRouteIds
    this.conflictStats.lastRepeatedOwnerRouteIds = repeatedOwnerRouteIds
    this.conflictStats.lastAlternateOwnerRouteIds = alternateOwnerRouteIds
    this.conflictStats.lastRippedRouteIds = [...rippedRouteIds]
    this.conflictStats.lastRelaxedSearchExpandedLabelCount =
      directPath.expandedLabelCount
    this.conflictStats.lastAlternateSearchExpandedLabelCount =
      alternatePath?.expandedLabelCount ?? 0
    this.publishConflictStats()
  }

  protected findRelaxedConflictPath(
    forbiddenOwnerRouteIds: ReadonlySet<RouteId> = new Set<RouteId>(),
  ): DistinctOwnerBlockerSearchResult<
    RelaxedSearchState,
    RouteId,
    RelaxedSearchHopData
  > {
    const routeId = this.state.currentRouteId
    const routeNetId = this.state.currentRouteNetId
    if (routeId === undefined || routeNetId === undefined) {
      throw new Error(
        "ConflictAwareTinyHyperGraphSolver: relaxed blocker search requires a current route and net",
      )
    }

    const startPortId = this.problem.routeStartPort[routeId]!
    const goalPortId = this.problem.routeEndPort[routeId]!
    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)
    if (startRegionId === undefined) {
      throw new Error(
        `ConflictAwareTinyHyperGraphSolver: route ${this.describeRoute(routeId)} has no starting region for relaxed blocker search`,
      )
    }

    const portOwners = this.getPortOwners()
    return findDistinctOwnerBlockerPath({
      start: { portId: startPortId, nextRegionId: startRegionId },
      getStateKey: ({ portId, nextRegionId }): number =>
        this.getHopId(portId, nextRegionId),
      isGoal: ({ portId }): boolean => portId === goalPortId,
      getHops: (state) =>
        this.getRelaxedSearchHops({
          state,
          goalPortId,
          routeNetId,
          portOwners,
          forbiddenOwnerRouteIds,
        }),
      maxExpandedLabels: this.getRelaxedSearchExpansionLimit(),
    })
  }

  protected getRelaxedSearchExpansionLimit(): number {
    let incidentHopCount = 0
    for (const incidentRegions of this.topology.incidentPortRegion) {
      incidentHopCount += incidentRegions.length
    }
    const ownerScale = Math.max(
      4,
      Math.ceil(Math.log2(this.problem.routeCount + 1)),
    )
    return Math.max(4096, incidentHopCount * ownerScale * 4)
  }

  private getRelaxedSearchHops(params: {
    state: RelaxedSearchState
    goalPortId: PortId
    routeNetId: number
    portOwners: ReadonlyMap<PortId, ReadonlySet<RouteId>>
    forbiddenOwnerRouteIds: ReadonlySet<RouteId>
  }): Array<{
    state: RelaxedSearchState
    distance: number
    owners: RouteId[]
    data: RelaxedSearchHopData
  }> {
    const { state, goalPortId, routeNetId } = params
    if (this.isRegionReservedForDifferentNet(state.nextRegionId)) return []

    const hops: Array<{
      state: RelaxedSearchState
      distance: number
      owners: RouteId[]
      data: RelaxedSearchHopData
    }> = []
    for (const neighborPortId of this.topology.regionIncidentPorts[
      state.nextRegionId
    ] ?? []) {
      if (neighborPortId === state.portId) continue
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      if (
        neighborPortId !== goalPortId &&
        this.problem.portSectionMask[neighborPortId] === 0
      ) {
        continue
      }

      const resources = this.getHopBlockerResources({
        regionId: state.nextRegionId,
        fromPortId: state.portId,
        toPortId: neighborPortId,
        routeNetId,
        portOwners: params.portOwners,
      })
      const owners = [
        ...new Set(resources.flatMap((resource) => resource.owners)),
      ]
      if (
        owners.some((ownerRouteId) =>
          params.forbiddenOwnerRouteIds.has(ownerRouteId),
        )
      ) {
        continue
      }

      let nextRegionId = state.nextRegionId
      if (neighborPortId !== goalPortId) {
        const incidentRegions =
          this.topology.incidentPortRegion[neighborPortId] ?? []
        nextRegionId =
          incidentRegions[0] === state.nextRegionId
            ? incidentRegions[1]!
            : incidentRegions[0]!
        if (
          nextRegionId === undefined ||
          this.isRegionReservedForDifferentNet(nextRegionId)
        ) {
          continue
        }
      }

      hops.push({
        state: { portId: neighborPortId, nextRegionId },
        distance: Math.hypot(
          this.topology.portX[state.portId]! -
            this.topology.portX[neighborPortId]!,
          this.topology.portY[state.portId]! -
            this.topology.portY[neighborPortId]!,
        ),
        owners,
        data: { resources },
      })
    }

    return hops
  }

  private getHopBlockerResources(params: {
    regionId: RegionId
    fromPortId: PortId
    toPortId: PortId
    routeNetId: number
    portOwners: ReadonlyMap<PortId, ReadonlySet<RouteId>>
  }): ConflictAwareBlockerResource[] {
    const resources: ConflictAwareBlockerResource[] = []
    const assignedNetId = this.state.portAssignment[params.toPortId]!
    if (assignedNetId !== -1 && assignedNetId !== params.routeNetId) {
      const owners = [...(params.portOwners.get(params.toPortId) ?? [])].filter(
        (routeId) => this.problem.routeNet[routeId] !== params.routeNetId,
      )
      if (owners.length === 0) {
        throw new Error(
          `ConflictAwareTinyHyperGraphSolver: port ${params.toPortId} is assigned to foreign net ${assignedNetId} without a committed route owner`,
        )
      }
      resources.push({ kind: "port", portId: params.toPortId, owners })
    }

    const crossingOwners = this.getStrictCrossingOwners(
      params.regionId,
      params.fromPortId,
      params.toPortId,
    )
    if (crossingOwners.length > 0) {
      resources.push({
        kind: "crossing",
        regionId: params.regionId,
        fromPortId: params.fromPortId,
        toPortId: params.toPortId,
        owners: crossingOwners,
      })
    }

    return resources
  }

  private getPortOwners(): Map<PortId, Set<RouteId>> {
    const ownersByPort = new Map<PortId, Set<RouteId>>()
    for (const segments of this.state.regionSegments) {
      for (const [routeId, fromPortId, toPortId] of segments) {
        for (const portId of [fromPortId, toPortId]) {
          const owners = ownersByPort.get(portId) ?? new Set<RouteId>()
          owners.add(routeId)
          ownersByPort.set(portId, owners)
        }
      }
    }

    return ownersByPort
  }

  private getStrictCrossingOwners(
    regionId: RegionId,
    fromPortId: PortId,
    toPortId: PortId,
  ): RouteId[] {
    if (!this.isKnownSingleLayerRegion(regionId)) return []

    const routeNetId = this.state.currentRouteNetId
    if (routeNetId === undefined) {
      throw new Error(
        "ConflictAwareTinyHyperGraphSolver: strict crossing check requires a current route net",
      )
    }
    const owners = new Set<RouteId>()
    for (const [ownerRouteId, ownerFromPortId, ownerToPortId] of this.state
      .regionSegments[regionId] ?? []) {
      if (this.problem.routeNet[ownerRouteId] === routeNetId) continue
      if (
        this.segmentsStrictlyCross(
          regionId,
          fromPortId,
          toPortId,
          ownerFromPortId,
          ownerToPortId,
        )
      ) {
        owners.add(ownerRouteId)
      }
    }

    return [...owners]
  }

  private segmentsStrictlyCross(
    regionId: RegionId,
    firstFromPortId: PortId,
    firstToPortId: PortId,
    secondFromPortId: PortId,
    secondToPortId: PortId,
  ): boolean {
    const first = {
      ...this.populateSegmentGeometryScratch(
        regionId,
        firstFromPortId,
        firstToPortId,
      ),
    }
    const second = {
      ...this.populateSegmentGeometryScratch(
        regionId,
        secondFromPortId,
        secondToPortId,
      ),
    }
    if ((first.layerMask & second.layerMask) === 0) return false
    if (
      first.lesserAngle === second.lesserAngle ||
      first.lesserAngle === second.greaterAngle ||
      first.greaterAngle === second.lesserAngle ||
      first.greaterAngle === second.greaterAngle
    ) {
      return false
    }

    const secondLesserInsideFirst =
      first.lesserAngle < second.lesserAngle &&
      second.lesserAngle < first.greaterAngle
    const secondGreaterInsideFirst =
      first.lesserAngle < second.greaterAngle &&
      second.greaterAngle < first.greaterAngle
    return secondLesserInsideFirst !== secondGreaterInsideFirst
  }

  private rebuildCommittedState(rippedRouteIds: ReadonlySet<RouteId>): void {
    this.state.regionSegments = this.state.regionSegments.map((segments) =>
      segments.filter(([routeId]) => !rippedRouteIds.has(routeId)),
    )
    this.state.portAssignment.fill(-1)
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )

    for (
      let regionId = 0;
      regionId < this.state.regionSegments.length;
      regionId++
    ) {
      for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
        regionId
      ]!) {
        const routeNetId = this.problem.routeNet[routeId]!
        this.state.currentRouteNetId = routeNetId
        for (const portId of [fromPortId, toPortId]) {
          const assignedNetId = this.state.portAssignment[portId]!
          if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
            throw new Error(
              `ConflictAwareTinyHyperGraphSolver: rebuilding committed routes found cross-net ownership at port ${portId} between net ${assignedNetId} and net ${routeNetId}`,
            )
          }
          this.state.portAssignment[portId] = routeNetId
        }
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    this.state.currentRouteNetId = undefined
  }

  private incrementFailedOwnerPair(
    failedRouteId: RouteId,
    ownerRouteId: RouteId,
  ): number {
    const ownerCounts =
      this.failedOwnerPairCounts.get(failedRouteId) ??
      new Map<RouteId, number>()
    const count = (ownerCounts.get(ownerRouteId) ?? 0) + 1
    ownerCounts.set(ownerRouteId, count)
    this.failedOwnerPairCounts.set(failedRouteId, ownerCounts)
    return count
  }

  private publishConflictStats(): void {
    const failedOwnerPairs: FailedOwnerPairCount[] = []
    for (const [failedRouteId, ownerCounts] of this.failedOwnerPairCounts) {
      for (const [ownerRouteId, count] of ownerCounts) {
        failedOwnerPairs.push({ failedRouteId, ownerRouteId, count })
      }
    }
    failedOwnerPairs.sort(
      (left, right) =>
        left.failedRouteId - right.failedRouteId ||
        left.ownerRouteId - right.ownerRouteId,
    )
    this.conflictStats.failedOwnerPairs = failedOwnerPairs
    this.conflictStats.failedOwnerPairCount = failedOwnerPairs.length
    this.conflictStats.maxFailedOwnerPairCount = Math.max(
      0,
      ...failedOwnerPairs.map(({ count }) => count),
    )
    this.stats = { ...this.stats, ...this.getConflictAwareStats() }
  }

  private describeRoute(routeId: RouteId): string {
    const connectionId = this.problem.routeMetadata?.[routeId]?.connectionId
    return connectionId === undefined
      ? String(routeId)
      : `${routeId} (${String(connectionId)})`
  }
}

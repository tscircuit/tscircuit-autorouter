// Forked from tiny-hypergraph commit 474f5222e799b54348da41d96a0da0694509fab8.
// Copyright (c) 2026 tscircuit. MIT license: see LICENSE in this directory.

import {
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "./OutsideInPartialRipTinyHyperGraphSolver"
import {
  type DistinctOwnerBlockerSearchResult,
} from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findPackedDistinctOwnerBlockerPath } from "./findPackedDistinctOwnerBlockerPath"
import type { PortId, RegionId, RouteId } from "tiny-hypergraph/lib/types"

type RelaxedSearchState = {
  portId: PortId
  nextRegionId: RegionId
}

type PortBlockerResource = {
  kind: "port"
  portId: PortId
  owners: RouteId[]
}

type SameLayerIntersectionBlockerResource = {
  kind: "same_layer_intersection"
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
  owners: RouteId[]
}

export type SelectiveReripBlockerResource =
  | PortBlockerResource
  | SameLayerIntersectionBlockerResource

type RelaxedSearchHopData = {
  resources: SelectiveReripBlockerResource[]
}

type RelaxedSearchHop = {
  state: RelaxedSearchState
  distance: number
  owners: RouteId[]
  data: RelaxedSearchHopData
}

const MAX_SELECTIVE_RERIP_CONGESTION_UPDATES = 1

export type FailedOwnerPairCount = {
  failedRouteId: RouteId
  ownerRouteId: RouteId
  count: number
}

export type SelectiveReripTinyHyperGraphStats = {
  selectiveRipCount: number
  selectivelyRippedRouteCount: number
  globalReripCount: number
  globalReripReason?:
    | "no_path"
    | "expansion_limit"
    | "no_blocker_path"
    | "failed_owner_cycle"
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

const createInitialSelectiveReripStats =
  (): SelectiveReripTinyHyperGraphStats => ({
    selectiveRipCount: 0,
    selectivelyRippedRouteCount: 0,
    globalReripCount: 0,
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

export function orderConnectionsByNetCardinality<TConnection>(
  connections: readonly TConnection[],
  getNetId: (connection: TConnection) => string | number,
): TConnection[] {
  const connectionCountByNetId = new Map<string | number, number>()
  for (const connection of connections) {
    const netId = getNetId(connection)
    connectionCountByNetId.set(
      netId,
      (connectionCountByNetId.get(netId) ?? 0) + 1,
    )
  }

  return connections
    .map((connection, index) => ({ connection, index }))
    .sort(
      (left, right) =>
        (connectionCountByNetId.get(getNetId(right.connection)) ?? 0) -
          (connectionCountByNetId.get(getNetId(left.connection)) ?? 0) ||
        left.index - right.index,
    )
    .map(({ connection }) => connection)
}

export function selectOwnerRouteIdsToRip(params: {
  failedRouteId: RouteId
  directOwnerRouteIds: readonly RouteId[]
  alternateOwnerRouteIds?: readonly RouteId[]
}): Set<RouteId> {
  const rippedRouteIds = new Set<RouteId>(
    params.alternateOwnerRouteIds ?? params.directOwnerRouteIds,
  )
  rippedRouteIds.delete(params.failedRouteId)
  if (rippedRouteIds.size === 0) {
    throw new Error(
      `SelectiveReripTinyHyperGraphSolver: route ${params.failedRouteId} has blocker resources but no distinct committed owner can be reripped`,
    )
  }

  return rippedRouteIds
}

export function orderRoutesAfterSelectiveRerip(params: {
  failedRouteId: RouteId
  pendingRouteIds: readonly RouteId[]
  rippedRouteIds: ReadonlySet<RouteId>
}): RouteId[] {
  const pendingRouteIds = params.pendingRouteIds.filter(
    (routeId) =>
      routeId !== params.failedRouteId && !params.rippedRouteIds.has(routeId),
  )
  const rippedRouteIds = [...params.rippedRouteIds].filter(
    (routeId) => routeId !== params.failedRouteId,
  )

  return [params.failedRouteId, ...pendingRouteIds, ...rippedRouteIds]
}

/**
 * Keeps the normal tiny-hypergraph route acceptance policy while replacing a
 * full rerip with a minimal, explicit rerip when the exhausted route has a
 * known set of committed blockers.
 */
export class SelectiveReripTinyHyperGraphSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  protected override costAwareFinalReripBudget = 8
  private readonly failedOwnerPairCounts = new Map<
    RouteId,
    Map<RouteId, number>
  >()

  private readonly selectiveReripStats = createInitialSelectiveReripStats()

  private selectiveReripCongestionUpdateCount = 0

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
  }

  getSelectiveReripStats(): SelectiveReripTinyHyperGraphStats {
    return {
      ...this.selectiveReripStats,
      failedOwnerPairs: this.selectiveReripStats.failedOwnerPairs.map(
        (pair) => ({
          ...pair,
        }),
      ),
      lastDirectOwnerRouteIds: [
        ...this.selectiveReripStats.lastDirectOwnerRouteIds,
      ],
      lastRepeatedOwnerRouteIds: [
        ...this.selectiveReripStats.lastRepeatedOwnerRouteIds,
      ],
      lastAlternateOwnerRouteIds: [
        ...this.selectiveReripStats.lastAlternateOwnerRouteIds,
      ],
      lastRippedRouteIds: [...this.selectiveReripStats.lastRippedRouteIds],
    }
  }

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    if (attempt >= 0)
      return super.createGreedyFinalRouteSolver(options, attempt)
    // Finishing a congested board still needs route costs and blocker rerips.
    // Zero-cost greedy paths can complete the graph but overwhelm detailed routing.
    const solver = new CongestionAwareFinalRouteSolver(
      this.topology,
      this.problem,
      {
        ...options,
        MAX_ITERATIONS: Math.max(
          options.MAX_ITERATIONS ?? 50_000,
          this.MAX_ITERATIONS * 2,
        ),
      },
    )
    solver.remainingReripBudget =
      this.costAwareFinalReripBudget - this.state.ripCount
    return solver
  }

  override onOutOfCandidates(): void {
    const failedRouteId = this.state.currentRouteId
    if (failedRouteId === undefined) {
      throw new Error(
        "SelectiveReripTinyHyperGraphSolver: candidate search exhausted without a current route",
      )
    }

    const directPath = this.findRelaxedBlockerPathPreferringPreservedRoutes()
    if (!directPath.found || directPath.owners.size === 0) {
      this.selectiveReripStats.globalReripCount += 1
      this.selectiveReripStats.globalReripReason = !directPath.found
        ? directPath.reason
        : "no_blocker_path"
      this.selectiveReripStats.lastFailedRouteId = failedRouteId
      this.selectiveReripStats.lastDirectOwnerRouteIds = []
      this.selectiveReripStats.lastRepeatedOwnerRouteIds = []
      this.selectiveReripStats.lastAlternateOwnerRouteIds = []
      this.selectiveReripStats.lastRippedRouteIds = []
      this.selectiveReripStats.lastRelaxedSearchExpandedLabelCount =
        directPath.expandedLabelCount
      this.selectiveReripStats.lastAlternateSearchExpandedLabelCount = 0
      super.onOutOfCandidates()
      this.publishSelectiveReripStats()
      return
    }

    const directOwnerRouteIds = [...directPath.owners]
    const repeatedOwnerRouteIds: RouteId[] = []
    for (const ownerRouteId of directOwnerRouteIds) {
      const count = this.incrementFailedOwnerPair(failedRouteId, ownerRouteId)
      if (count >= 2) repeatedOwnerRouteIds.push(ownerRouteId)
    }
    if (
      directOwnerRouteIds.some((ownerRouteId) =>
        this.hasFailedOwnerPath(ownerRouteId, failedRouteId),
      )
    ) {
      this.selectiveReripStats.globalReripCount += 1
      this.selectiveReripStats.globalReripReason = "failed_owner_cycle"
      this.selectiveReripStats.lastFailedRouteId = failedRouteId
      this.selectiveReripStats.lastDirectOwnerRouteIds = directOwnerRouteIds
      this.selectiveReripStats.lastRepeatedOwnerRouteIds = repeatedOwnerRouteIds
      this.selectiveReripStats.lastAlternateOwnerRouteIds = []
      this.selectiveReripStats.lastRippedRouteIds = []
      this.selectiveReripStats.lastRelaxedSearchExpandedLabelCount =
        directPath.expandedLabelCount
      this.selectiveReripStats.lastAlternateSearchExpandedLabelCount = 0
      this.failedOwnerPairCounts.clear()
      super.onOutOfCandidates()
      this.publishSelectiveReripStats()
      return
    }

    let alternatePath:
      | DistinctOwnerBlockerSearchResult<
          RelaxedSearchState,
          RouteId,
          RelaxedSearchHopData
        >
      | undefined
    if (repeatedOwnerRouteIds.length > 0) {
      this.selectiveReripStats.alternateBlockerSearchCount += 1
      alternatePath = this.findRelaxedBlockerPathPreferringPreservedRoutes(
        new Set(repeatedOwnerRouteIds),
      )
      if (!alternatePath.found) {
        this.selectiveReripStats.globalReripCount += 1
        this.selectiveReripStats.globalReripReason = alternatePath.reason
        this.selectiveReripStats.lastFailedRouteId = failedRouteId
        this.selectiveReripStats.lastDirectOwnerRouteIds = directOwnerRouteIds
        this.selectiveReripStats.lastRepeatedOwnerRouteIds =
          repeatedOwnerRouteIds
        this.selectiveReripStats.lastAlternateOwnerRouteIds = []
        this.selectiveReripStats.lastRippedRouteIds = []
        this.selectiveReripStats.lastRelaxedSearchExpandedLabelCount =
          directPath.expandedLabelCount
        this.selectiveReripStats.lastAlternateSearchExpandedLabelCount =
          alternatePath.expandedLabelCount
        super.onOutOfCandidates()
        this.publishSelectiveReripStats()
        return
      }
    }

    const alternateOwnerRouteIds = alternatePath?.found
      ? [...alternatePath.owners]
      : undefined
    const rippedRouteIds = selectOwnerRouteIdsToRip({
      failedRouteId,
      directOwnerRouteIds,
      alternateOwnerRouteIds,
    })
    this.clearPartialRipPlans(rippedRouteIds)
    const alternateOnlyOwnerRouteIds = (alternateOwnerRouteIds ?? []).filter(
      (ownerRouteId) => !directPath.owners.has(ownerRouteId),
    )
    if (
      this.selectiveReripCongestionUpdateCount <
      MAX_SELECTIVE_RERIP_CONGESTION_UPDATES
    ) {
      this.addCongestionCostForSelectiveRerip()
      this.selectiveReripCongestionUpdateCount += 1
    }
    this.rebuildCommittedState(rippedRouteIds)
    this.state.ripCount += 1
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = orderRoutesAfterSelectiveRerip({
      failedRouteId,
      pendingRouteIds: this.state.unroutedRoutes,
      rippedRouteIds,
    })
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1

    this.selectiveReripStats.selectiveRipCount += 1
    this.selectiveReripStats.selectivelyRippedRouteCount += rippedRouteIds.size
    this.selectiveReripStats.alternateOwnerCount +=
      alternateOnlyOwnerRouteIds.length
    this.selectiveReripStats.lastFailedRouteId = failedRouteId
    this.selectiveReripStats.lastDirectOwnerRouteIds = directOwnerRouteIds
    this.selectiveReripStats.lastRepeatedOwnerRouteIds = repeatedOwnerRouteIds
    this.selectiveReripStats.lastAlternateOwnerRouteIds =
      alternateOnlyOwnerRouteIds
    this.selectiveReripStats.lastRippedRouteIds = [...rippedRouteIds]
    this.selectiveReripStats.lastRelaxedSearchExpandedLabelCount =
      directPath.expandedLabelCount
    this.selectiveReripStats.lastAlternateSearchExpandedLabelCount =
      alternatePath?.expandedLabelCount ?? 0
    this.publishSelectiveReripStats()
  }

  private addCongestionCostForSelectiveRerip(): void {
    for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
      const regionCost =
        this.state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      this.state.regionCongestionCost[regionId] +=
        regionCost * this.RIP_CONGESTION_REGION_COST_FACTOR
    }
  }

  protected findRelaxedBlockerPath(
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
        "SelectiveReripTinyHyperGraphSolver: blocker search requires a current route and net",
      )
    }

    const startPortId = this.getRouteStartPortId(routeId)
    const goalPortId = this.getRouteEndPortId(routeId)
    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)
    if (startRegionId === undefined) {
      throw new Error(
        `SelectiveReripTinyHyperGraphSolver: route ${this.describeRoute(routeId)} has no starting region for blocker search`,
      )
    }

    const portOwners = this.getPortOwners()
    const portResources = new Map<PortId, PortBlockerResource>()
    const hopTemplatesByRegion = new Map<RegionId, RelaxedSearchHop[]>()
    // Occupancy stays fixed during this synchronous search. Distinct owner
    // labels revisit the same hop, but their outgoing resources are identical.
    const hopsByState = new Map<number, RelaxedSearchHop[]>()
    return findPackedDistinctOwnerBlockerPath({
      ownerCount: this.problem.routeCount,
      start: { portId: startPortId, nextRegionId: startRegionId },
      getStateKey: ({ portId, nextRegionId }): number =>
        this.getHopId(portId, nextRegionId),
      isGoal: ({ portId }): boolean => portId === goalPortId,
      getHops: (state): RelaxedSearchHop[] => {
        const key = this.getHopId(state.portId, state.nextRegionId)
        const cached = hopsByState.get(key)
        if (cached) return cached
        const hops = this.getRelaxedSearchHops({
          state,
          goalPortId,
          routeNetId,
          portOwners,
          portResources,
          hopTemplatesByRegion,
          forbiddenOwnerRouteIds,
        })
        hopsByState.set(key, hops)
        return hops
      },
      maxExpandedLabels: this.getRelaxedSearchExpansionLimit(),
      checkReachability: true,
    })
  }

  protected findRelaxedBlockerPathPreferringPreservedRoutes(
    forbiddenOwnerRouteIds: ReadonlySet<RouteId> = new Set<RouteId>(),
  ): DistinctOwnerBlockerSearchResult<
    RelaxedSearchState,
    RouteId,
    RelaxedSearchHopData
  > {
    const preferredPreservedRouteIds =
      this.getRouteIdsPreferredForPreservation()
    if (preferredPreservedRouteIds.size === 0) {
      return this.findRelaxedBlockerPath(forbiddenOwnerRouteIds)
    }

    const preferredForbiddenOwnerRouteIds = new Set(forbiddenOwnerRouteIds)
    for (const routeId of preferredPreservedRouteIds) {
      preferredForbiddenOwnerRouteIds.add(routeId)
    }
    const preferredPath = this.findRelaxedBlockerPath(
      preferredForbiddenOwnerRouteIds,
    )
    if (preferredPath.found && preferredPath.owners.size > 0) {
      return preferredPath
    }

    return this.findRelaxedBlockerPath(forbiddenOwnerRouteIds)
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
    portResources: Map<PortId, PortBlockerResource>
    forbiddenOwnerRouteIds: ReadonlySet<RouteId>
    hopTemplatesByRegion: Map<RegionId, RelaxedSearchHop[]>
    buildRegionTemplates?: boolean
  }): RelaxedSearchHop[] {
    const { state, goalPortId, routeNetId } = params
    if (this.isRegionReservedForDifferentNet(state.nextRegionId)) return []
    // In multilayer regions, reservations and blocker resources depend only
    // on the destination. Share their immutable metadata across incoming hops;
    // each directed edge still gets its original distance and ordering.
    if (
      !params.buildRegionTemplates &&
      !this.isKnownSingleLayerRegion(state.nextRegionId)
    ) {
      let templates = params.hopTemplatesByRegion.get(state.nextRegionId)
      if (!templates) {
        templates = this.getRelaxedSearchHops({
          ...params,
          buildRegionTemplates: true,
        })
        params.hopTemplatesByRegion.set(state.nextRegionId, templates)
      }
      const hops: RelaxedSearchHop[] = []
      for (const template of templates) {
        if (template.state.portId === state.portId) continue
        hops.push({
          state: template.state,
          owners: template.owners,
          data: template.data,
          distance: Math.hypot(
            this.topology.portX[state.portId]! -
              this.topology.portX[template.state.portId]!,
            this.topology.portY[state.portId]! -
              this.topology.portY[template.state.portId]!,
          ),
        })
      }
      return hops
    }

    const hops: RelaxedSearchHop[] = []
    for (const neighborPortId of this.topology.regionIncidentPorts[
      state.nextRegionId
    ] ?? []) {
      if (neighborPortId === state.portId && !params.buildRegionTemplates)
        continue
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
        portResources: params.portResources,
      })
      const owners: RouteId[] = []
      for (const resource of resources) {
        for (const owner of resource.owners) {
          if (!owners.includes(owner)) owners.push(owner)
        }
      }
      if (
        owners.some((ownerRouteId) =>
          params.forbiddenOwnerRouteIds.has(ownerRouteId),
        )
      ) {
        continue
      }

      let nextRegionId = state.nextRegionId
      if (neighborPortId !== goalPortId) {
        const [firstRegionId, secondRegionId] =
          this.topology.incidentPortRegion[neighborPortId] ?? []
        nextRegionId =
          firstRegionId === state.nextRegionId ? secondRegionId : firstRegionId
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
    portResources: Map<PortId, PortBlockerResource>
  }): SelectiveReripBlockerResource[] {
    const resources: SelectiveReripBlockerResource[] = []
    const assignedNetId = this.state.portAssignment[params.toPortId]!
    if (assignedNetId !== -1 && assignedNetId !== params.routeNetId) {
      let resource = params.portResources.get(params.toPortId)
      if (!resource) {
        const owners = [
          ...(params.portOwners.get(params.toPortId) ?? new Set<RouteId>()),
        ].filter(
          (routeId) => this.problem.routeNet[routeId] !== params.routeNetId,
        )
        if (owners.length === 0) {
          throw new Error(
            `SelectiveReripTinyHyperGraphSolver: port ${params.toPortId} is assigned to foreign net ${assignedNetId} without a committed route owner`,
          )
        }
        resource = { kind: "port", portId: params.toPortId, owners }
        params.portResources.set(params.toPortId, resource)
      }
      resources.push(resource)
    }

    const sameLayerIntersectionOwners = this.getHardBlockedCrossingOwners(
      params.regionId,
      params.fromPortId,
      params.toPortId,
    )
    if (sameLayerIntersectionOwners.length > 0) {
      resources.push({
        kind: "same_layer_intersection",
        regionId: params.regionId,
        fromPortId: params.fromPortId,
        toPortId: params.toPortId,
        owners: sameLayerIntersectionOwners,
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

  private getHardBlockedCrossingOwners(
    regionId: RegionId,
    fromPortId: PortId,
    toPortId: PortId,
  ): RouteId[] {
    if (!this.isKnownSingleLayerRegion(regionId)) return []

    const routeNetId = this.state.currentRouteNetId
    if (routeNetId === undefined) {
      throw new Error(
        "SelectiveReripTinyHyperGraphSolver: crossing ownership requires a current route net",
      )
    }
    const owners = new Set<RouteId>()
    for (const [ownerRouteId, ownerFromPortId, ownerToPortId] of this.state
      .regionSegments[regionId] ?? []) {
      if (this.problem.routeNet[ownerRouteId] === routeNetId) continue
      if (
        this.segmentsCrossOnSameLayer(
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

  private segmentsCrossOnSameLayer(
    regionId: RegionId,
    firstFromPortId: PortId,
    firstToPortId: PortId,
    secondFromPortId: PortId,
    secondToPortId: PortId,
  ): boolean {
    const first = this.populateSegmentGeometryScratch(
      regionId,
      firstFromPortId,
      firstToPortId,
    )
    const firstLesserAngle = first.lesserAngle
    const firstGreaterAngle = first.greaterAngle
    const firstLayerMask = first.layerMask
    const second = this.populateSegmentGeometryScratch(
      regionId,
      secondFromPortId,
      secondToPortId,
    )
    if ((firstLayerMask & second.layerMask) === 0) return false
    if (
      firstLesserAngle === second.lesserAngle ||
      firstLesserAngle === second.greaterAngle ||
      firstGreaterAngle === second.lesserAngle ||
      firstGreaterAngle === second.greaterAngle
    ) {
      return false
    }

    const secondLesserInsideFirst =
      firstLesserAngle < second.lesserAngle &&
      second.lesserAngle < firstGreaterAngle
    const secondGreaterInsideFirst =
      firstLesserAngle < second.greaterAngle &&
      second.greaterAngle < firstGreaterAngle
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
              `SelectiveReripTinyHyperGraphSolver: rebuilding committed routes found cross-net ownership at port ${portId} between net ${assignedNetId} and net ${routeNetId}`,
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

  private hasFailedOwnerPath(
    fromRouteId: RouteId,
    targetRouteId: RouteId,
  ): boolean {
    const pendingRouteIds = [fromRouteId]
    const visitedRouteIds = new Set<RouteId>()
    while (pendingRouteIds.length > 0) {
      const routeId = pendingRouteIds.pop()!
      if (routeId === targetRouteId) return true
      if (visitedRouteIds.has(routeId)) continue
      visitedRouteIds.add(routeId)
      pendingRouteIds.push(
        ...(this.failedOwnerPairCounts.get(routeId)?.keys() ?? []),
      )
    }
    return false
  }

  private publishSelectiveReripStats(): void {
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
    this.selectiveReripStats.failedOwnerPairs = failedOwnerPairs
    this.selectiveReripStats.failedOwnerPairCount = failedOwnerPairs.length
    this.selectiveReripStats.maxFailedOwnerPairCount = Math.max(
      0,
      ...failedOwnerPairs.map(({ count }) => count),
    )
    this.stats = { ...this.stats, ...this.getSelectiveReripStats() }
  }

  private describeRoute(routeId: RouteId): string {
    const connectionId = this.problem.routeMetadata?.[routeId]?.connectionId
    return connectionId === undefined
      ? String(routeId)
      : `${routeId} (${String(connectionId)})`
  }
}

export class CongestionAwareFinalRouteSolver extends SelectiveReripTinyHyperGraphSolver {
  remainingReripBudget = 0

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    // This completion candidate shares its rerip budget with the parent search.
    // Repeated rearrangements indicate that more of the same search is unhelpful.
    if (this.state.ripCount >= this.remainingReripBudget) {
      this.failed = true
      this.error = "Congestion-aware final routing exhausted its rerip budget"
    }
  }
}

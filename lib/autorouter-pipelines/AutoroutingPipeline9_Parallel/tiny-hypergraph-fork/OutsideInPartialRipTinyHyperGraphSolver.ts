// Forked from tiny-hypergraph commit 474f5222e799b54348da41d96a0da0694509fab8.
// Copyright (c) 2026 tscircuit. MIT license: see LICENSE in this directory.

import {
  type Candidate,
  createEmptyRegionIntersectionCache,
  type RegionCostSummary,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { MinHeap } from "tiny-hypergraph/lib/MinHeap"
import type { PortId, RegionId, RouteId } from "tiny-hypergraph/lib/types"

type CommittedRouteSegment = {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

type PartialRipRoutePlan = {
  routeId: RouteId
  activeStartPortId: PortId
  activeEndPortId: PortId
  forcedStartRegionId: RegionId
  forcedEndRegionId: RegionId
  rippedSegmentCount: number
  retainedSegmentCount: number
}

type OutsideInCandidate = Candidate & {
  travelDistance: number
}

type OutsideInFrontier = {
  queue: MinHeap<OutsideInCandidate>
  bestCostByHopId: Map<number, number>
  settledByPortId: Map<PortId, OutsideInCandidate>
  settledByRegionId: Map<RegionId, OutsideInCandidate[]>
  targetPortId: PortId
}

type OutsideInRouteSearch = {
  routeId: RouteId
  forward: OutsideInFrontier
  reverse: OutsideInFrontier
  expandForwardNext: boolean
  distanceLimitHit: boolean
  bestJoinedCandidate?: Candidate
  bestJoinedCost: number
  remainingPostMeetingExpansions?: number
}

type JoinedOutsideInCandidate = {
  candidate: Candidate
  cost: number
}

type IndexedCommittedRouteSegment = CommittedRouteSegment & {
  segmentIndex: number
}

type CompletedRoundSummary = RegionCostSummary & {
  ripCount: number
  segmentCount: number
  maxRegionSegmentCount: number
  squaredRegionSegmentCount: number
}

const NO_PREFERRED_PRESERVED_ROUTE_IDS = new Set<RouteId>()

/**
 * Retains the two outside portions of a completed route and only reroutes a
 * bounded window around a congested region. The active window is represented
 * as a normal route with temporary endpoints, so all existing cost and hard
 * constraint checks continue to apply.
 *
 * Outside-in frontier search is implemented by this class separately from the
 * partial-rip state transition. Initial whole routes retain the established
 * one-ended search; the bounded two-ended search applies to reopened spans.
 */
export class OutsideInPartialRipTinyHyperGraphSolver extends DistanceAwareTinyHyperGraphSolver {
  protected partialRipRoutePlans = new Map<RouteId, PartialRipRoutePlan>()
  private outsideInRouteSearch?: OutsideInRouteSearch
  private oneSidedFallbackRouteId?: RouteId
  private partialRipWindowDistance?: number
  private partialRipCount = 0
  private partiallyRippedRouteCount = 0
  private partiallyRippedSegmentCount = 0
  private retainedPartialRipSegmentCount = 0
  private outsideInRouteCount = 0
  private outsideInCompletedRouteCount = 0
  private outsideInFallbackRouteCount = 0
  private outsideInForwardExpansionCount = 0
  private outsideInReverseExpansionCount = 0
  private outsideInDistancePruneCount = 0
  private completedRoundSummaries: CompletedRoundSummary[] = []
  private firstCompletedRoundSummary?: CompletedRoundSummary
  private partialRipQualityBaselineSummary?: CompletedRoundSummary
  private bestSolvedRoundSummary?: CompletedRoundSummary
  private partialRipTargetReached = false
  private useComplexityAwareSelection = false

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    if (options?.PARTIAL_RIP_ENABLED === undefined) {
      this.PARTIAL_RIP_ENABLED = true
    }
    if (options?.OUTSIDE_IN_ROUTING === undefined) {
      this.OUTSIDE_IN_ROUTING = true
    }
    if (
      this.PARTIAL_RIP_ENABLED &&
      options?.PARTIAL_RIP_MAX_ATTEMPTS === undefined
    ) {
      this.PARTIAL_RIP_MAX_ATTEMPTS = 10
    }
    if (
      problem.routeCount < Math.max(0, this.PARTIAL_RIP_MIN_ROUTE_COUNT) ||
      problem.routeCount > Math.max(0, this.PARTIAL_RIP_MAX_ROUTE_COUNT)
    ) {
      this.PARTIAL_RIP_ENABLED = false
      this.OUTSIDE_IN_ROUTING = false
    }
    this.useComplexityAwareSelection =
      problem.routeCount >=
      Math.max(0, this.PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT)
  }

  protected override getRouteStartPortId(routeId: RouteId): PortId {
    if (!this.PARTIAL_RIP_ENABLED) {
      return super.getRouteStartPortId(routeId)
    }
    return (
      this.partialRipRoutePlans.get(routeId)?.activeStartPortId ??
      super.getRouteStartPortId(routeId)
    )
  }

  protected override getRouteEndPortId(routeId: RouteId): PortId {
    if (!this.PARTIAL_RIP_ENABLED) {
      return super.getRouteEndPortId(routeId)
    }
    return (
      this.partialRipRoutePlans.get(routeId)?.activeEndPortId ??
      super.getRouteEndPortId(routeId)
    )
  }

  override getStartingNextRegionId(
    routeId: RouteId,
    startingPortId: PortId,
  ): RegionId | undefined {
    if (!this.PARTIAL_RIP_ENABLED) {
      return super.getStartingNextRegionId(routeId, startingPortId)
    }
    const partialRipRoutePlan = this.partialRipRoutePlans.get(routeId)
    if (
      partialRipRoutePlan &&
      partialRipRoutePlan.activeStartPortId === startingPortId
    ) {
      return partialRipRoutePlan.forcedStartRegionId
    }

    return super.getStartingNextRegionId(routeId, startingPortId)
  }

  private getEndingNextRegionId(
    routeId: RouteId,
    endingPortId: PortId,
  ): RegionId | undefined {
    const partialRipRoutePlan = this.partialRipRoutePlans.get(routeId)
    if (
      partialRipRoutePlan &&
      partialRipRoutePlan.activeEndPortId === endingPortId
    ) {
      return partialRipRoutePlan.forcedEndRegionId
    }

    return super.getStartingNextRegionId(routeId, endingPortId)
  }

  override computeH(neighborPortId: PortId): number {
    if (!this.PARTIAL_RIP_ENABLED) {
      return super.computeH(neighborPortId)
    }
    const routeId = this.state.currentRouteId
    if (routeId === undefined || !this.partialRipRoutePlans.has(routeId)) {
      return super.computeH(neighborPortId)
    }

    const endPortId = this.getRouteEndPortId(routeId)
    const dx =
      this.topology.portX[neighborPortId]! - this.topology.portX[endPortId]!
    const dy =
      this.topology.portY[neighborPortId]! - this.topology.portY[endPortId]!
    return Math.sqrt(dx * dx + dy * dy) * this.DISTANCE_TO_COST
  }

  override onPathFound(finalCandidate: Candidate): void {
    if (!this.PARTIAL_RIP_ENABLED && !this.OUTSIDE_IN_ROUTING) {
      super.onPathFound(finalCandidate)
      return
    }
    const routeId = this.state.currentRouteId
    const completedOutsideInRoute =
      routeId !== undefined && this.outsideInRouteSearch?.routeId === routeId
    super.onPathFound(finalCandidate)
    if (routeId !== undefined && this.state.currentRouteId === undefined) {
      this.partialRipRoutePlans.delete(routeId)
      if (completedOutsideInRoute) this.outsideInCompletedRouteCount += 1
      if (this.oneSidedFallbackRouteId === routeId) {
        this.oneSidedFallbackRouteId = undefined
      }
    }
    this.outsideInRouteSearch = undefined
    this.publishOutsideInStats()
  }

  override resetRoutingStateForRerip(): void {
    if (!this.PARTIAL_RIP_ENABLED && !this.OUTSIDE_IN_ROUTING) {
      super.resetRoutingStateForRerip()
      return
    }
    this.partialRipRoutePlans.clear()
    this.outsideInRouteSearch = undefined
    this.oneSidedFallbackRouteId = undefined
    super.resetRoutingStateForRerip()
  }

  protected clearPartialRipPlans(routeIds: ReadonlySet<RouteId>): void {
    for (const routeId of routeIds) {
      this.partialRipRoutePlans.delete(routeId)
    }
  }

  /**
   * Quality rerips retain these routes when other routes cross the same hot
   * regions. Completion rerips may still use them when they are unavoidable.
   */
  protected getRouteIdsPreferredForPreservation(): ReadonlySet<RouteId> {
    return NO_PREFERRED_PRESERVED_ROUTE_IDS
  }

  private indexCommittedSegmentsByRouteId(): Map<RouteId, IndexedCommittedRouteSegment[]> {
    const indexedByRouteId = new Map<RouteId, IndexedCommittedRouteSegment[]>()
    for (let regionId = 0; regionId < this.state.regionSegments.length; regionId++) {
      for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[regionId] ?? []) {
        let indexedSegments = indexedByRouteId.get(routeId)
        if (!indexedSegments) {
          indexedSegments = []
          indexedByRouteId.set(routeId, indexedSegments)
        }
        indexedSegments.push({
          segmentIndex: indexedSegments.length, regionId, fromPortId, toPortId,
        })
      }
    }
    return indexedByRouteId
  }

  private getCommittedRouteSegments(
    routeId: RouteId,
    indexedSegments: IndexedCommittedRouteSegment[] | undefined,
  ): CommittedRouteSegment[] | undefined {
    if (!indexedSegments || indexedSegments.length === 0) return undefined

    const segmentIndicesByPortId = new Map<PortId, number[]>()
    for (const segment of indexedSegments) {
      for (const portId of [segment.fromPortId, segment.toPortId]) {
        const segmentIndices = segmentIndicesByPortId.get(portId) ?? []
        segmentIndices.push(segment.segmentIndex)
        segmentIndicesByPortId.set(portId, segmentIndices)
      }
    }

    const endPortId = this.problem.routeEndPort[routeId]!
    const orderedSegments: CommittedRouteSegment[] = []
    const usedSegmentIndices = new Set<number>()
    const visitedPortIds = new Set<PortId>([
      this.problem.routeStartPort[routeId]!,
    ])

    const appendPathToEnd = (portId: PortId): boolean => {
      if (portId === endPortId) return true

      for (const segmentIndex of segmentIndicesByPortId.get(portId) ?? []) {
        if (usedSegmentIndices.has(segmentIndex)) continue
        const segment = indexedSegments[segmentIndex]!
        const nextPortId =
          segment.fromPortId === portId ? segment.toPortId : segment.fromPortId
        if (visitedPortIds.has(nextPortId)) continue

        usedSegmentIndices.add(segmentIndex)
        visitedPortIds.add(nextPortId)
        orderedSegments.push({
          regionId: segment.regionId,
          fromPortId: portId,
          toPortId: nextPortId,
        })

        if (appendPathToEnd(nextPortId)) return true

        orderedSegments.pop()
        visitedPortIds.delete(nextPortId)
        usedSegmentIndices.delete(segmentIndex)
      }

      return false
    }

    if (
      !appendPathToEnd(this.problem.routeStartPort[routeId]!) ||
      usedSegmentIndices.size !== indexedSegments.length
    ) {
      return undefined
    }

    return orderedSegments
  }

  private getSegmentDistance(segment: CommittedRouteSegment): number {
    const dx =
      this.topology.portX[segment.fromPortId]! -
      this.topology.portX[segment.toPortId]!
    const dy =
      this.topology.portY[segment.fromPortId]! -
      this.topology.portY[segment.toPortId]!
    return Math.sqrt(dx * dx + dy * dy)
  }

  private getPartialRipWindow(
    orderedSegments: readonly CommittedRouteSegment[],
    hotRegionIds: ReadonlySet<RegionId>,
    regionCosts: Float64Array,
  ): { startIndex: number; endIndex: number } | undefined {
    let hottestSegmentIndex: number | undefined
    let hottestSegmentCost = Number.NEGATIVE_INFINITY

    for (
      let segmentIndex = 0;
      segmentIndex < orderedSegments.length;
      segmentIndex++
    ) {
      const segment = orderedSegments[segmentIndex]!
      if (!hotRegionIds.has(segment.regionId)) continue
      const regionCost = regionCosts[segment.regionId] ?? 0
      if (regionCost > hottestSegmentCost) {
        hottestSegmentCost = regionCost
        hottestSegmentIndex = segmentIndex
      }
    }

    if (hottestSegmentIndex === undefined) return undefined

    const maxDistance = Math.max(
      0,
      this.partialRipWindowDistance ?? this.PARTIAL_RIP_MAX_DISTANCE,
    )
    let startIndex = hottestSegmentIndex
    let endIndex = hottestSegmentIndex
    let startDistance =
      this.getSegmentDistance(orderedSegments[hottestSegmentIndex]!) / 2
    let endDistance = startDistance

    while (startIndex > 0) {
      const nextDistance = this.getSegmentDistance(
        orderedSegments[startIndex - 1]!,
      )
      if (startDistance + nextDistance > maxDistance) break
      startIndex -= 1
      startDistance += nextDistance
    }

    while (endIndex + 1 < orderedSegments.length) {
      const nextDistance = this.getSegmentDistance(
        orderedSegments[endIndex + 1]!,
      )
      if (endDistance + nextDistance > maxDistance) break
      endIndex += 1
      endDistance += nextDistance
    }

    return { startIndex, endIndex }
  }

  private appendRetainedSegment(
    retainedSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
    routeId: RouteId,
    segment: CommittedRouteSegment,
  ): void {
    retainedSegmentsByRegion[segment.regionId]!.push([
      routeId,
      segment.fromPortId,
      segment.toPortId,
    ])
  }

  protected preparePartialRip(
    hotRegionIds: readonly RegionId[],
    regionCosts: Float64Array,
  ): boolean {
    if (!this.PARTIAL_RIP_ENABLED || hotRegionIds.length === 0) return false

    const hotRegionIdSet = new Set(hotRegionIds)
    if (this.partialRipWindowDistance === undefined) {
      // A near-target solution usually has one stubborn local minimum. Give
      // that run more topology to work with, and latch the choice so window
      // sizes do not oscillate as congestion changes between rounds.
      let maxHotRegionCost = 0
      for (const regionId of hotRegionIds) {
        maxHotRegionCost = Math.max(
          maxHotRegionCost,
          regionCosts[regionId] ?? 0,
        )
      }
      const baseDistance = Math.max(0, this.PARTIAL_RIP_MAX_DISTANCE)
      const qualityDistance = Math.max(
        baseDistance,
        this.PARTIAL_RIP_QUALITY_MAX_DISTANCE ?? baseDistance * 2,
      )
      this.partialRipWindowDistance =
        maxHotRegionCost <= this.RIP_THRESHOLD_END * 1.5
          ? qualityDistance
          : baseDistance
    }
    const routeIdsTouchingHotRegions = new Set<RouteId>()
    for (const regionId of hotRegionIds) {
      for (const [routeId] of this.state.regionSegments[regionId] ?? []) {
        routeIdsTouchingHotRegions.add(routeId)
      }
    }
    if (routeIdsTouchingHotRegions.size === 0) return false
    const preferredPreservedRouteIds =
      this.getRouteIdsPreferredForPreservation()
    const hasNonPreferredRouteTouchingHotRegions = [
      ...routeIdsTouchingHotRegions,
    ].some((routeId) => !preferredPreservedRouteIds.has(routeId))

    const retainedSegmentsByRegion = Array.from(
      { length: this.topology.regionCount },
      () => [] as [RouteId, PortId, PortId][],
    )
    const nextPlans = new Map<RouteId, PartialRipRoutePlan>()
    let rippedSegmentCount = 0
    let retainedSegmentCount = 0

    // Preserve the original region/segment encounter order for each route,
    // while scanning board occupancy once for this immutable preparation phase.
    const indexedByRouteId = this.indexCommittedSegmentsByRouteId()
    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const orderedSegments = this.getCommittedRouteSegments(routeId, indexedByRouteId.get(routeId))
      if (!orderedSegments) return false

      if (
        !routeIdsTouchingHotRegions.has(routeId) ||
        (hasNonPreferredRouteTouchingHotRegions &&
          preferredPreservedRouteIds.has(routeId))
      ) {
        for (const segment of orderedSegments) {
          this.appendRetainedSegment(retainedSegmentsByRegion, routeId, segment)
          retainedSegmentCount += 1
        }
        continue
      }

      const window = this.getPartialRipWindow(
        orderedSegments,
        hotRegionIdSet,
        regionCosts,
      )
      if (!window) return false

      for (
        let segmentIndex = 0;
        segmentIndex < orderedSegments.length;
        segmentIndex++
      ) {
        const segment = orderedSegments[segmentIndex]!
        if (
          segmentIndex >= window.startIndex &&
          segmentIndex <= window.endIndex
        ) {
          rippedSegmentCount += 1
          continue
        }
        this.appendRetainedSegment(retainedSegmentsByRegion, routeId, segment)
        retainedSegmentCount += 1
      }

      const firstRippedSegment = orderedSegments[window.startIndex]!
      const lastRippedSegment = orderedSegments[window.endIndex]!
      nextPlans.set(routeId, {
        routeId,
        activeStartPortId: firstRippedSegment.fromPortId,
        activeEndPortId: lastRippedSegment.toPortId,
        forcedStartRegionId: firstRippedSegment.regionId,
        forcedEndRegionId: lastRippedSegment.regionId,
        rippedSegmentCount: window.endIndex - window.startIndex + 1,
        retainedSegmentCount:
          orderedSegments.length - (window.endIndex - window.startIndex + 1),
      })
    }

    if (nextPlans.size === 0 || rippedSegmentCount === 0) return false

    this.partialRipRoutePlans = nextPlans
    this.rebuildRetainedRoutingState(retainedSegmentsByRegion, [
      ...nextPlans.keys(),
    ])
    this.partialRipCount += 1
    this.partiallyRippedRouteCount += nextPlans.size
    this.partiallyRippedSegmentCount += rippedSegmentCount
    this.retainedPartialRipSegmentCount += retainedSegmentCount
    this.publishPartialRipStats()
    return true
  }

  private rebuildRetainedRoutingState(
    retainedSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
    unroutedRouteIds: RouteId[],
  ): void {
    this.state.portAssignment.fill(-1)
    this.state.regionSegments = Array.from(
      { length: this.topology.regionCount },
      () => [],
    )
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = unroutedRouteIds
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
    this.outsideInRouteSearch = undefined
    this.oneSidedFallbackRouteId = undefined

    for (
      let regionId = 0;
      regionId < retainedSegmentsByRegion.length;
      regionId++
    ) {
      for (const [routeId, fromPortId, toPortId] of retainedSegmentsByRegion[
        regionId
      ] ?? []) {
        const routeNetId = this.problem.routeNet[routeId]!
        this.state.currentRouteNetId = routeNetId
        for (const portId of [fromPortId, toPortId]) {
          const assignedNetId = this.state.portAssignment[portId]!
          if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
            throw new Error(
              `OutsideInPartialRipTinyHyperGraphSolver: retained port ${portId} belongs to multiple nets`,
            )
          }
          this.state.portAssignment[portId] = routeNetId
        }
        this.state.regionSegments[regionId]!.push([
          routeId,
          fromPortId,
          toPortId,
        ])
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    this.state.currentRouteNetId = undefined
  }

  private publishPartialRipStats(): void {
    this.stats = {
      ...this.stats,
      partialRipCount: this.partialRipCount,
      partiallyRippedRouteCount: this.partiallyRippedRouteCount,
      partiallyRippedSegmentCount: this.partiallyRippedSegmentCount,
      retainedPartialRipSegmentCount: this.retainedPartialRipSegmentCount,
      partialRipMaxDistance:
        this.partialRipWindowDistance ?? this.PARTIAL_RIP_MAX_DISTANCE,
      partialRipBaseMaxDistance: this.PARTIAL_RIP_MAX_DISTANCE,
      partialRipQualityMaxDistance:
        this.PARTIAL_RIP_QUALITY_MAX_DISTANCE ??
        this.PARTIAL_RIP_MAX_DISTANCE * 2,
      partialRipMaxAttempts: this.PARTIAL_RIP_MAX_ATTEMPTS,
    }
  }

  private publishOutsideInStats(): void {
    this.stats = {
      ...this.stats,
      outsideInRouteCount: this.outsideInRouteCount,
      outsideInCompletedRouteCount: this.outsideInCompletedRouteCount,
      outsideInFallbackRouteCount: this.outsideInFallbackRouteCount,
      outsideInForwardExpansionCount: this.outsideInForwardExpansionCount,
      outsideInReverseExpansionCount: this.outsideInReverseExpansionCount,
      outsideInDistancePruneCount: this.outsideInDistancePruneCount,
      outsideInMaxDistance: this.OUTSIDE_IN_MAX_DISTANCE,
    }
  }

  private createOutsideInFrontier(
    startPortId: PortId,
    startRegionId: RegionId,
    targetPortId: PortId,
  ): OutsideInFrontier {
    const queue = new MinHeap<OutsideInCandidate>([], (left, right) =>
      left.f === right.f ? left.g - right.g : left.f - right.f,
    )
    const dx =
      this.topology.portX[startPortId]! - this.topology.portX[targetPortId]!
    const dy =
      this.topology.portY[startPortId]! - this.topology.portY[targetPortId]!
    const h = Math.sqrt(dx * dx + dy * dy) * this.DISTANCE_TO_COST
    const root: OutsideInCandidate = {
      portId: startPortId,
      nextRegionId: startRegionId,
      f: h,
      g: 0,
      h,
      travelDistance: 0,
    }
    queue.queue(root)
    return {
      queue,
      bestCostByHopId: new Map([
        [this.getHopId(startPortId, startRegionId), 0],
      ]),
      settledByPortId: new Map(),
      settledByRegionId: new Map(),
      targetPortId,
    }
  }

  private startOutsideInRouteSearch(routeId: RouteId): boolean {
    const startPortId = this.getRouteStartPortId(routeId)
    const endPortId = this.getRouteEndPortId(routeId)
    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)
    const endRegionId = this.getEndingNextRegionId(routeId, endPortId)
    if (startRegionId === undefined || endRegionId === undefined) return false

    this.state.goalPortId = endPortId
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.outsideInRouteSearch = {
      routeId,
      forward: this.createOutsideInFrontier(
        startPortId,
        startRegionId,
        endPortId,
      ),
      reverse: this.createOutsideInFrontier(
        endPortId,
        endRegionId,
        startPortId,
      ),
      expandForwardNext: true,
      distanceLimitHit: false,
      bestJoinedCost: Number.POSITIVE_INFINITY,
    }
    this.outsideInRouteCount += 1
    this.publishOutsideInStats()
    return true
  }

  private dequeueFreshCandidate(
    frontier: OutsideInFrontier,
  ): OutsideInCandidate | undefined {
    while (frontier.queue.length > 0) {
      const candidate = frontier.queue.dequeue()!
      const hopId = this.getHopId(candidate.portId, candidate.nextRegionId)
      if (candidate.g <= (frontier.bestCostByHopId.get(hopId) ?? Infinity)) {
        return candidate
      }
    }
    return undefined
  }

  private recordSettledCandidate(
    frontier: OutsideInFrontier,
    candidate: OutsideInCandidate,
  ): void {
    const settledAtPort = frontier.settledByPortId.get(candidate.portId)
    if (!settledAtPort || candidate.g < settledAtPort.g) {
      frontier.settledByPortId.set(candidate.portId, candidate)
    }

    const settledInRegion =
      frontier.settledByRegionId.get(candidate.nextRegionId) ?? []
    settledInRegion.push(candidate)
    settledInRegion.sort((left, right) => left.g - right.g)
    if (settledInRegion.length > 16) settledInRegion.length = 16
    frontier.settledByRegionId.set(candidate.nextRegionId, settledInRegion)
  }

  private getCandidatePath(
    candidate: OutsideInCandidate,
  ): OutsideInCandidate[] {
    const path: OutsideInCandidate[] = []
    let cursor: Candidate | undefined = candidate
    while (cursor) {
      path.push(cursor as OutsideInCandidate)
      cursor = cursor.prevCandidate
    }
    path.reverse()
    return path
  }

  private buildJoinedCandidate(
    forwardCandidate: OutsideInCandidate,
    reverseCandidate: OutsideInCandidate,
  ): JoinedOutsideInCandidate | undefined {
    const forwardPath = this.getCandidatePath(forwardCandidate)
    const reversePath = this.getCandidatePath(reverseCandidate)
    const portIds = forwardPath.map(({ portId }) => portId)
    const regionIds = forwardPath
      .slice(0, -1)
      .map(({ nextRegionId }) => nextRegionId)

    if (forwardCandidate.portId !== reverseCandidate.portId) {
      if (forwardCandidate.nextRegionId !== reverseCandidate.nextRegionId) {
        return undefined
      }
      const connectorDx =
        this.topology.portX[forwardCandidate.portId]! -
        this.topology.portX[reverseCandidate.portId]!
      const connectorDy =
        this.topology.portY[forwardCandidate.portId]! -
        this.topology.portY[reverseCandidate.portId]!
      const connectorDistance = Math.sqrt(
        connectorDx * connectorDx + connectorDy * connectorDy,
      )
      if (
        forwardCandidate.travelDistance +
          reverseCandidate.travelDistance +
          connectorDistance >
        this.OUTSIDE_IN_MAX_DISTANCE * 2
      ) {
        return undefined
      }
      const connectorG = this.computeG(
        forwardCandidate,
        reverseCandidate.portId,
      )
      if (!Number.isFinite(connectorG)) return undefined
      regionIds.push(forwardCandidate.nextRegionId)
      portIds.push(reverseCandidate.portId)
    }

    for (
      let reverseIndex = reversePath.length - 2;
      reverseIndex >= 0;
      reverseIndex--
    ) {
      const nextTowardGoal = reversePath[reverseIndex]!
      regionIds.push(nextTowardGoal.nextRegionId)
      portIds.push(nextTowardGoal.portId)
    }

    if (
      new Set(portIds).size !== portIds.length ||
      regionIds.length + 1 !== portIds.length
    ) {
      return undefined
    }

    let joinedCandidate: Candidate = {
      portId: portIds[0]!,
      nextRegionId: regionIds[0]!,
      f: 0,
      g: 0,
      h: 0,
    }
    for (let portIndex = 1; portIndex < portIds.length; portIndex++) {
      joinedCandidate = {
        portId: portIds[portIndex]!,
        prevRegionId: regionIds[portIndex - 1]!,
        nextRegionId: regionIds[portIndex] ?? regionIds[portIndex - 1]!,
        prevCandidate: joinedCandidate,
        f: 0,
        g: 0,
        h: 0,
      }
    }

    const connectorCost =
      forwardCandidate.portId === reverseCandidate.portId
        ? 0
        : this.computeG(forwardCandidate, reverseCandidate.portId) -
          forwardCandidate.g

    return {
      candidate: joinedCandidate,
      cost: forwardCandidate.g + reverseCandidate.g + connectorCost,
    }
  }

  private considerOutsideInJoins(
    candidate: OutsideInCandidate,
    expandingForward: boolean,
  ): void {
    const search = this.outsideInRouteSearch!
    const oppositeFrontier = expandingForward ? search.reverse : search.forward
    const considerJoinedCandidate = (
      joinedCandidate: JoinedOutsideInCandidate | undefined,
    ) => {
      if (!joinedCandidate || joinedCandidate.cost >= search.bestJoinedCost) {
        return
      }
      search.bestJoinedCandidate = joinedCandidate.candidate
      search.bestJoinedCost = joinedCandidate.cost
      search.remainingPostMeetingExpansions = 24
    }

    const samePortCandidate = oppositeFrontier.settledByPortId.get(
      candidate.portId,
    )
    if (samePortCandidate) {
      considerJoinedCandidate(
        expandingForward
          ? this.buildJoinedCandidate(candidate, samePortCandidate)
          : this.buildJoinedCandidate(samePortCandidate, candidate),
      )
    }

    for (const oppositeCandidate of oppositeFrontier.settledByRegionId.get(
      candidate.nextRegionId,
    ) ?? []) {
      considerJoinedCandidate(
        expandingForward
          ? this.buildJoinedCandidate(candidate, oppositeCandidate)
          : this.buildJoinedCandidate(oppositeCandidate, candidate),
      )
    }
  }

  private commitBestOutsideInJoin(): boolean {
    const joinedCandidate = this.outsideInRouteSearch?.bestJoinedCandidate
    if (!joinedCandidate) return false
    this.onPathFound(joinedCandidate)
    return true
  }

  private expandOutsideInFrontier(expandingForward: boolean): boolean {
    const search = this.outsideInRouteSearch!
    const frontier = expandingForward ? search.forward : search.reverse
    const candidate = this.dequeueFreshCandidate(frontier)
    if (!candidate) return false

    if (expandingForward) this.outsideInForwardExpansionCount += 1
    else this.outsideInReverseExpansionCount += 1

    if (this.isRegionReservedForDifferentNet(candidate.nextRegionId)) {
      return true
    }

    this.recordSettledCandidate(frontier, candidate)
    this.considerOutsideInJoins(candidate, expandingForward)

    for (const neighborPortId of this.topology.regionIncidentPorts[
      candidate.nextRegionId
    ] ?? []) {
      if (neighborPortId === candidate.portId) continue
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      const assignedNetId = this.state.portAssignment[neighborPortId]!
      if (
        assignedNetId !== -1 &&
        assignedNetId !== this.state.currentRouteNetId
      ) {
        continue
      }
      if (
        neighborPortId !== frontier.targetPortId &&
        this.problem.portSectionMask[neighborPortId] === 0
      ) {
        continue
      }

      const segmentDx =
        this.topology.portX[candidate.portId]! -
        this.topology.portX[neighborPortId]!
      const segmentDy =
        this.topology.portY[candidate.portId]! -
        this.topology.portY[neighborPortId]!
      const segmentDistance = Math.sqrt(
        segmentDx * segmentDx + segmentDy * segmentDy,
      )
      const travelDistance = candidate.travelDistance + segmentDistance
      if (travelDistance > this.OUTSIDE_IN_MAX_DISTANCE) {
        search.distanceLimitHit = true
        this.outsideInDistancePruneCount += 1
        continue
      }

      const nextRegionId =
        this.topology.incidentPortRegion[neighborPortId]?.[0] ===
        candidate.nextRegionId
          ? this.topology.incidentPortRegion[neighborPortId]?.[1]
          : this.topology.incidentPortRegion[neighborPortId]?.[0]
      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentNet(nextRegionId)
      ) {
        continue
      }

      const hopId = this.getHopId(neighborPortId, nextRegionId)
      const previousBestCost = frontier.bestCostByHopId.get(hopId) ?? Infinity
      if (candidate.g >= previousBestCost) continue

      const g = this.computeG(
        candidate,
        neighborPortId,
        previousBestCost,
        segmentDistance,
      )
      if (!Number.isFinite(g) || g >= previousBestCost) continue
      frontier.bestCostByHopId.set(hopId, g)
      const heuristicDx =
        this.topology.portX[neighborPortId]! -
        this.topology.portX[frontier.targetPortId]!
      const heuristicDy =
        this.topology.portY[neighborPortId]! -
        this.topology.portY[frontier.targetPortId]!
      const h =
        Math.sqrt(heuristicDx * heuristicDx + heuristicDy * heuristicDy) *
        this.DISTANCE_TO_COST
      frontier.queue.queue({
        portId: neighborPortId,
        prevRegionId: candidate.nextRegionId,
        nextRegionId,
        prevCandidate: candidate,
        f: g + h,
        g,
        h,
        travelDistance,
      })
    }

    return true
  }

  private fallBackToOneSidedRouteSearch(): void {
    const routeId = this.state.currentRouteId
    if (routeId === undefined) return
    this.outsideInRouteSearch = undefined
    this.outsideInFallbackRouteCount += 1
    this.oneSidedFallbackRouteId = routeId
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.goalPortId = -1
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.unroutedRoutes.unshift(routeId)
    this.publishOutsideInStats()
  }

  override _step(): void {
    if (!this.OUTSIDE_IN_ROUTING) {
      super._step()
      return
    }

    const routeIdToAdvance =
      this.state.currentRouteId ?? this.state.unroutedRoutes[0]
    if (
      routeIdToAdvance !== undefined &&
      !this.partialRipRoutePlans.has(routeIdToAdvance)
    ) {
      super._step()
      return
    }

    if (this.oneSidedFallbackRouteId !== undefined) {
      super._step()
      return
    }

    if (this.state.currentRouteId === undefined) {
      if (this.state.unroutedRoutes.length === 0) {
        this.onAllRoutesRouted()
        return
      }

      const routeId = this.state.unroutedRoutes.shift()!
      this.state.currentRouteId = routeId
      this.state.currentRouteNetId = this.problem.routeNet[routeId]!
      this.routeAttemptCountByRouteId[routeId] += 1
      if (!this.startOutsideInRouteSearch(routeId)) {
        this.failed = true
        this.error = `Route ${routeId} has an endpoint without an incident region`
        return
      }
    }

    const search = this.outsideInRouteSearch
    if (!search) return

    let expanded = this.expandOutsideInFrontier(search.expandForwardNext)
    if (this.state.currentRouteId === undefined) return
    if (!expanded) {
      expanded = this.expandOutsideInFrontier(!search.expandForwardNext)
      if (this.state.currentRouteId === undefined) return
    }
    search.expandForwardNext = !search.expandForwardNext

    if (search.bestJoinedCandidate) {
      search.remainingPostMeetingExpansions =
        (search.remainingPostMeetingExpansions ?? 1) - 1
      if ((search.remainingPostMeetingExpansions ?? 0) <= 0) {
        this.commitBestOutsideInJoin()
        return
      }
    }

    if (
      !expanded &&
      search.forward.queue.length === 0 &&
      search.reverse.queue.length === 0
    ) {
      if (this.commitBestOutsideInJoin()) return
      this.outsideInRouteSearch = undefined
      if (search.distanceLimitHit) {
        this.fallBackToOneSidedRouteSearch()
      } else {
        this.onOutOfCandidates()
      }
    }

    this.publishOutsideInStats()
  }

  private shouldReplaceBestSolvedState(
    summary: CompletedRoundSummary,
  ): boolean {
    const bestSummary = this.bestSolvedRoundSummary
    if (!bestSummary) return true
    if (!this.useComplexityAwareSelection) {
      return this.compareRegionCostSummaries(summary, bestSummary) < 0
    }

    const qualityBaseline = this.partialRipQualityBaselineSummary
    if (!qualityBaseline) {
      return this.compareRegionCostSummaries(summary, bestSummary) < 0
    }
    const selectionBaseline = this.firstCompletedRoundSummary ?? qualityBaseline

    const maxRegionCostCeiling =
      selectionBaseline.maxRegionCost *
      (1 + Math.max(0, this.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO))
    const totalRegionCostCeiling =
      selectionBaseline.totalRegionCost *
      (1 + Math.max(0, this.PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO))
    const isEligible =
      summary.maxRegionCost <= maxRegionCostCeiling &&
      summary.totalRegionCost <= totalRegionCostCeiling
    const isBestEligible =
      bestSummary.maxRegionCost <= maxRegionCostCeiling &&
      bestSummary.totalRegionCost <= totalRegionCostCeiling

    if (isEligible !== isBestEligible) return isEligible
    if (isEligible && summary.segmentCount !== bestSummary.segmentCount) {
      return summary.segmentCount < bestSummary.segmentCount
    }
    return this.compareRegionCostSummaries(summary, bestSummary) < 0
  }

  override onAllRoutesRouted(): void {
    if (!this.PARTIAL_RIP_ENABLED) {
      super.onAllRoutesRouted()
      return
    }

    const { state, topology } = this
    const maxRipAttempts = Math.min(
      this.RIP_THRESHOLD_RAMP_ATTEMPTS,
      this.PARTIAL_RIP_MAX_ATTEMPTS,
    )
    const ripThresholdRampAttempts = Math.max(
      0,
      this.RIP_THRESHOLD_RAMP_ATTEMPTS,
    )
    const ripThresholdProgress =
      ripThresholdRampAttempts <= 0
        ? 1
        : Math.min(1, state.ripCount / ripThresholdRampAttempts)
    const currentRipThreshold =
      this.RIP_THRESHOLD_START +
      (this.RIP_THRESHOLD_END - this.RIP_THRESHOLD_START) * ripThresholdProgress
    const regionCosts = new Float64Array(topology.regionCount)
    const hotRegionIds: RegionId[] = []
    let maxRegionCost = 0
    let totalRegionCost = 0
    let segmentCount = 0
    let maxRegionSegmentCount = 0
    let squaredRegionSegmentCount = 0

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      regionCosts[regionId] = regionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)
      totalRegionCost += regionCost
      const regionSegmentCount = state.regionSegments[regionId]?.length ?? 0
      segmentCount += regionSegmentCount
      maxRegionSegmentCount = Math.max(
        maxRegionSegmentCount,
        regionSegmentCount,
      )
      squaredRegionSegmentCount += regionSegmentCount * regionSegmentCount
      if (regionCost > currentRipThreshold) hotRegionIds.push(regionId)
    }

    const summary: RegionCostSummary = { maxRegionCost, totalRegionCost }
    const completedRoundSummary: CompletedRoundSummary = {
      ...summary,
      ripCount: state.ripCount,
      segmentCount,
      maxRegionSegmentCount,
      squaredRegionSegmentCount,
    }
    this.completedRoundSummaries.push(completedRoundSummary)
    this.firstCompletedRoundSummary ??= completedRoundSummary
    if (
      this.partialRipQualityBaselineSummary === undefined &&
      state.ripCount >= Math.max(0, this.PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS)
    ) {
      this.partialRipQualityBaselineSummary = completedRoundSummary
    }
    const shouldReplaceBest = this.shouldReplaceBestSolvedState(
      completedRoundSummary,
    )
    if (shouldReplaceBest) {
      this.replaceBestSolvedState(summary)
      this.bestSolvedRoundSummary = completedRoundSummary
    }

    const firstRound = this.firstCompletedRoundSummary
    const qualityBaseline = this.partialRipQualityBaselineSummary ?? firstRound
    const targetImprovementRatio = Math.max(
      0,
      this.PARTIAL_RIP_TARGET_MAX_COST_IMPROVEMENT_RATIO,
    )
    const maxTotalCostGrowthRatio = Math.max(
      0,
      this.PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO,
    )
    const targetMaxRegionCost =
      qualityBaseline.maxRegionCost * (1 - targetImprovementRatio)
    const maxTargetTotalRegionCost =
      qualityBaseline.totalRegionCost * (1 + maxTotalCostGrowthRatio)
    const targetReached =
      this.useComplexityAwareSelection &&
      state.ripCount > qualityBaseline.ripCount &&
      targetImprovementRatio > 0 &&
      maxRegionCost <= targetMaxRegionCost &&
      totalRegionCost <= maxTargetTotalRegionCost &&
      segmentCount <= qualityBaseline.segmentCount
    if (targetReached) this.partialRipTargetReached = true
    this.stats = {
      ...this.stats,
      currentRipThreshold,
      hotRegionCount: hotRegionIds.length,
      maxRegionCost,
      totalRegionCost,
      bestMaxRegionCost: this.bestSolvedStateSummary?.maxRegionCost,
      bestTotalRegionCost: this.bestSolvedStateSummary?.totalRegionCost,
      ripCount: state.ripCount,
      completedRoundSummaries: this.completedRoundSummaries.map(
        (roundSummary) => ({ ...roundSummary }),
      ),
      firstMaxRegionCost: firstRound.maxRegionCost,
      firstTotalRegionCost: firstRound.totalRegionCost,
      firstSegmentCount: firstRound.segmentCount,
      firstMaxRegionSegmentCount: firstRound.maxRegionSegmentCount,
      firstSquaredRegionSegmentCount: firstRound.squaredRegionSegmentCount,
      partialRipQualityBaselineRipCount: qualityBaseline.ripCount,
      partialRipQualityBaselineMaxRegionCost: qualityBaseline.maxRegionCost,
      partialRipQualityBaselineTotalRegionCost: qualityBaseline.totalRegionCost,
      partialRipQualityBaselineSegmentCount: qualityBaseline.segmentCount,
      partialRipQualityBaselineMaxRegionSegmentCount:
        qualityBaseline.maxRegionSegmentCount,
      partialRipQualityBaselineSquaredRegionSegmentCount:
        qualityBaseline.squaredRegionSegmentCount,
      bestSolvedSegmentCount: this.bestSolvedRoundSummary?.segmentCount,
      bestSolvedMaxRegionSegmentCount:
        this.bestSolvedRoundSummary?.maxRegionSegmentCount,
      bestSolvedSquaredRegionSegmentCount:
        this.bestSolvedRoundSummary?.squaredRegionSegmentCount,
      partialRipTargetMaxRegionCost: targetMaxRegionCost,
      partialRipMaxTargetTotalRegionCost: maxTargetTotalRegionCost,
      partialRipComplexityAwareSelection: this.useComplexityAwareSelection,
      partialRipComplexitySelectionMinRouteCount:
        this.PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT,
      partialRipMaxRegionCostGrowthRatio:
        this.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO,
      partialRipTargetReached: this.partialRipTargetReached,
    }
    this.publishPartialRipStats()

    if (
      hotRegionIds.length === 0 ||
      targetReached ||
      state.ripCount >= maxRipAttempts
    ) {
      this.restoreBestSolvedState()
      this.solved = true
      return
    }

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      state.regionCongestionCost[regionId] +=
        regionCosts[regionId]! * this.RIP_CONGESTION_REGION_COST_FACTOR
    }

    const usedWarmupFullRip =
      state.ripCount < Math.max(0, this.PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS)
    state.ripCount += 1
    const usedPartialRip =
      !usedWarmupFullRip && this.preparePartialRip(hotRegionIds, regionCosts)
    if (!usedPartialRip) {
      this.resetRoutingStateForRerip()
    }
    const reripMode = usedWarmupFullRip
      ? "warmup_full"
      : usedPartialRip
        ? "partial"
        : "full_fallback"
    this.stats = {
      ...this.stats,
      ripCount: state.ripCount,
      maxRegionCostBeforeRip: maxRegionCost,
      reripRegionCount: hotRegionIds.length,
      reripMode,
      partialRipWarmupFullRipAttempts:
        this.PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS,
    }
    this.logRipEvent("hot_regions", maxRegionCost, {
      hotRegionCount: hotRegionIds.length,
      currentRipThreshold,
      reripMode,
      partialRouteCount: usedPartialRip ? this.partialRipRoutePlans.size : 0,
    })
  }
}

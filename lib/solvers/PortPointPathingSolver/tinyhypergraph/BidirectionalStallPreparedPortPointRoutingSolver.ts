import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { MinHeap } from "tiny-hypergraph/lib/MinHeap"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import type {
  HopId,
  PortId,
  RegionId,
  RouteId,
} from "tiny-hypergraph/lib/types"

const DEFAULT_BIDIRECTIONAL_STALL_THRESHOLD = 10_000
const POST_MEETING_EXPANSIONS = 24
const MAX_SETTLED_CANDIDATES_PER_REGION = 16

type BidirectionalFrontier = {
  queue: MinHeap<Candidate>
  closedHopIds: Set<HopId>
  bestCostByHopId: Map<HopId, number>
  settledByHopId: Map<HopId, Candidate>
  settledByPortId: Map<PortId, Candidate>
  settledByRegionId: Map<RegionId, Candidate[]>
  goalPortId: PortId
  goalX: number
  goalY: number
}

type JoinedBidirectionalCandidate = {
  candidate: Candidate
  cost: number
}

type ActiveBidirectionalSearch = {
  routeId: RouteId
  startPortId: PortId
  endPortId: PortId
  allowReverseBlockerFlip: boolean
  forward: BidirectionalFrontier
  reverse: BidirectionalFrontier
  bestJoined?: JoinedBidirectionalCandidate
  remainingPostMeetingExpansions?: number
}

export type BidirectionalStallStats = {
  triggerCount: number
  solvedCount: number
  disconnectedCount: number
  reverseBlockerFlipCount: number
}

const compareCandidates = (left: Candidate, right: Candidate): number =>
  left.f === right.f ? left.g - right.g : left.f - right.f

const getCandidatePath = (candidate: Candidate): Candidate[] => {
  const path: Candidate[] = []
  let cursor: Candidate | undefined = candidate
  while (cursor) {
    path.push(cursor)
    cursor = cursor.prevCandidate
  }
  path.reverse()
  return path
}

const pathContainsPort = (candidate: Candidate, portId: PortId): boolean => {
  let cursor: Candidate | undefined = candidate
  while (cursor) {
    if (cursor.portId === portId) return true
    cursor = cursor.prevCandidate
  }
  return false
}

const buildCandidateChain = (
  portIds: readonly PortId[],
  regionIds: readonly RegionId[],
  cost: number,
): Candidate => {
  let candidate: Candidate = {
    portId: portIds[0]!,
    nextRegionId: regionIds[0]!,
    f: 0,
    g: 0,
    h: 0,
  }
  for (let i = 1; i < portIds.length; i++) {
    candidate = {
      portId: portIds[i]!,
      prevRegionId: regionIds[i - 1]!,
      nextRegionId: regionIds[i] ?? regionIds[i - 1]!,
      prevCandidate: candidate,
      f: cost,
      g: cost,
      h: 0,
    }
  }
  return candidate
}

/**
 * Keeps the normal PreparedPortPointRoutingSolver hot path bit-for-bit
 * identical for routes that finish within the stall threshold.
 *
 * When a whole route stalls (typically because one or both endpoints sit
 * behind a high portPenalty bridge or inside a dynamically sealed pocket),
 * switches to exact cycle-free bidirectional A* balanced by Pohl's cardinality
 * criterion so the boxed-in frontier expands out of its pocket immediately
 * instead of flooding the open board.
 */
export class BidirectionalStallPreparedPortPointRoutingSolver extends PreparedPortPointRoutingSolver {
  BIDIRECTIONAL_STALL_THRESHOLD = DEFAULT_BIDIRECTIONAL_STALL_THRESHOLD

  private bidirectionalStallActiveRouteId?: RouteId
  private bidirectionalStallActiveRouteSteps = 0
  private bidirectionalStallSearch?: ActiveBidirectionalSearch
  private bidirectionalStallFlippedBlockerRouteId?: RouteId
  private bidirectionalStallStats: BidirectionalStallStats = {
    triggerCount: 0,
    solvedCount: 0,
    disconnectedCount: 0,
    reverseBlockerFlipCount: 0,
  }

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
  }

  getBidirectionalStallStats(): BidirectionalStallStats {
    return { ...this.bidirectionalStallStats }
  }

  protected override getRouteStartPortId(routeId: RouteId): PortId {
    if (this.bidirectionalStallFlippedBlockerRouteId === routeId) {
      return super.getRouteEndPortId(routeId)
    }
    return super.getRouteStartPortId(routeId)
  }

  protected override getRouteEndPortId(routeId: RouteId): PortId {
    if (this.bidirectionalStallFlippedBlockerRouteId === routeId) {
      return super.getRouteStartPortId(routeId)
    }
    return super.getRouteEndPortId(routeId)
  }

  override onPathFound(finalCandidate: Candidate): void {
    const previousRouteId = this.state.currentRouteId
    super.onPathFound(finalCandidate)
    if (
      previousRouteId !== undefined &&
      this.state.currentRouteId === undefined
    ) {
      this.clearBidirectionalStallTracking()
    }
  }

  override onOutOfCandidates(): void {
    this.clearBidirectionalStallTracking()
    super.onOutOfCandidates()
  }

  override resetRoutingStateForRerip(): void {
    this.clearBidirectionalStallTracking()
    this.bidirectionalStallFlippedBlockerRouteId = undefined
    super.resetRoutingStateForRerip()
  }

  override _step(): void {
    if (this.bidirectionalStallSearch !== undefined) {
      if (this.state.currentRouteId === this.bidirectionalStallSearch.routeId) {
        this.stepBidirectionalStallSearch()
        return
      }
      this.bidirectionalStallSearch = undefined
    }

    const currentRouteId = this.state.currentRouteId
    if (currentRouteId !== this.bidirectionalStallActiveRouteId) {
      this.bidirectionalStallActiveRouteId = currentRouteId
      this.bidirectionalStallActiveRouteSteps = 0
    }

    if (currentRouteId !== undefined) {
      this.bidirectionalStallActiveRouteSteps += 1
      if (
        this.bidirectionalStallActiveRouteSteps ===
          this.BIDIRECTIONAL_STALL_THRESHOLD &&
        !this.partialRipRoutePlans.has(currentRouteId) &&
        this.startBidirectionalStallSearch(currentRouteId)
      ) {
        this.stepBidirectionalStallSearch()
        return
      }
    }

    super._step()
  }

  private clearBidirectionalStallTracking(): void {
    this.bidirectionalStallSearch = undefined
    this.bidirectionalStallActiveRouteId = undefined
    this.bidirectionalStallActiveRouteSteps = 0
  }

  private createBidirectionalStallFrontier(
    seedPortId: PortId,
    seedRegionIds: readonly RegionId[],
    goalPortId: PortId,
    initialCost: number,
  ): BidirectionalFrontier {
    const queue = new MinHeap<Candidate>([], compareCandidates)
    const bestCostByHopId = new Map<HopId, number>()
    const goalX = this.topology.portX[goalPortId]!
    const goalY = this.topology.portY[goalPortId]!
    const startDx = this.topology.portX[seedPortId]! - goalX
    const startDy = this.topology.portY[seedPortId]! - goalY
    const h =
      Math.sqrt(startDx * startDx + startDy * startDy) * this.DISTANCE_TO_COST

    for (const seedRegionId of seedRegionIds) {
      const hopId = this.getHopId(seedPortId, seedRegionId)
      if (bestCostByHopId.has(hopId)) continue
      bestCostByHopId.set(hopId, initialCost)
      queue.queue({
        hopId,
        portId: seedPortId,
        nextRegionId: seedRegionId,
        g: initialCost,
        h,
        f: initialCost + h,
      })
    }

    return {
      queue,
      closedHopIds: new Set(),
      bestCostByHopId,
      settledByHopId: new Map(),
      settledByPortId: new Map(),
      settledByRegionId: new Map(),
      goalPortId,
      goalX,
      goalY,
    }
  }

  private startBidirectionalStallSearch(routeId: RouteId): boolean {
    const startPortId = this.getRouteStartPortId(routeId)
    const endPortId = this.getRouteEndPortId(routeId)
    if (startPortId === endPortId) return false

    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)
    if (
      startRegionId === undefined ||
      this.isRegionReservedForDifferentNet(startRegionId)
    ) {
      return false
    }

    const endIncidentRegions = this.topology.incidentPortRegion[endPortId] ?? []
    const unreservedEndRegions = endIncidentRegions.filter(
      (regionId) => this.problem.regionNetId[regionId] === -1,
    )
    let reverseSeedRegions: RegionId[]
    if (unreservedEndRegions.length > 0) {
      reverseSeedRegions = unreservedEndRegions
    } else {
      const fallbackEndRegionId = this.getStartingNextRegionId(
        routeId,
        endPortId,
      )
      if (
        fallbackEndRegionId === undefined ||
        this.isRegionReservedForDifferentNet(fallbackEndRegionId)
      ) {
        return false
      }
      reverseSeedRegions = [fallbackEndRegionId]
    }

    const endPortPenalty = this.problem.portPenalty?.[endPortId] ?? 0
    this.state.goalPortId = endPortId
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()

    this.bidirectionalStallSearch = {
      routeId,
      startPortId,
      endPortId,
      allowReverseBlockerFlip: reverseSeedRegions.length === 1,
      forward: this.createBidirectionalStallFrontier(
        startPortId,
        [startRegionId],
        endPortId,
        0,
      ),
      reverse: this.createBidirectionalStallFrontier(
        endPortId,
        reverseSeedRegions,
        startPortId,
        endPortPenalty,
      ),
    }
    this.bidirectionalStallStats.triggerCount += 1
    return true
  }

  private dequeueFreshBidirectionalStallCandidate(
    frontier: BidirectionalFrontier,
  ): Candidate | undefined {
    while (frontier.queue.length > 0) {
      const candidate = frontier.queue.dequeue()!
      const hopId =
        candidate.hopId ??
        this.getHopId(candidate.portId, candidate.nextRegionId)
      if (frontier.closedHopIds.has(hopId)) continue
      const bestCost =
        frontier.bestCostByHopId.get(hopId) ?? Number.POSITIVE_INFINITY
      if (candidate.g > bestCost) continue
      frontier.closedHopIds.add(hopId)
      return candidate
    }
    return undefined
  }

  private recordSettledBidirectionalStallCandidate(
    frontier: BidirectionalFrontier,
    hopId: HopId,
    candidate: Candidate,
  ): void {
    frontier.settledByHopId.set(hopId, candidate)

    const settledAtPort = frontier.settledByPortId.get(candidate.portId)
    if (!settledAtPort || candidate.g < settledAtPort.g) {
      frontier.settledByPortId.set(candidate.portId, candidate)
    }

    const settledInRegion =
      frontier.settledByRegionId.get(candidate.nextRegionId) ?? []
    let inserted = false
    for (let i = 0; i < settledInRegion.length; i++) {
      if (candidate.g < settledInRegion[i]!.g) {
        settledInRegion.splice(i, 0, candidate)
        inserted = true
        break
      }
    }
    if (
      !inserted &&
      settledInRegion.length < MAX_SETTLED_CANDIDATES_PER_REGION
    ) {
      settledInRegion.push(candidate)
    }
    if (settledInRegion.length > MAX_SETTLED_CANDIDATES_PER_REGION) {
      settledInRegion.length = MAX_SETTLED_CANDIDATES_PER_REGION
    }
    frontier.settledByRegionId.set(candidate.nextRegionId, settledInRegion)
  }

  private recordJoinedBidirectionalStallCandidate(
    search: ActiveBidirectionalSearch,
    joined: JoinedBidirectionalCandidate,
  ): void {
    if (!search.bestJoined || joined.cost < search.bestJoined.cost) {
      search.bestJoined = joined
    }
    if (search.remainingPostMeetingExpansions === undefined) {
      search.remainingPostMeetingExpansions = POST_MEETING_EXPANSIONS
    }
  }

  private buildJoinedBidirectionalStallCandidate(
    forwardCandidate: Candidate,
    reverseCandidate: Candidate,
    startPortId: PortId,
    endPortId: PortId,
  ): JoinedBidirectionalCandidate | undefined {
    const forwardPath = getCandidatePath(forwardCandidate)
    const reversePath = getCandidatePath(reverseCandidate)

    let forwardLength = forwardPath.length
    let reverseLength = reversePath.length

    while (forwardLength > 0 && reverseLength > 0) {
      let reduced = false
      const forwardIndexByPortId = new Map<PortId, number>()
      for (let i = 0; i < forwardLength; i++) {
        forwardIndexByPortId.set(forwardPath[i]!.portId, i)
      }

      for (let r = 0; r < reverseLength; r++) {
        const sharedForwardIndex = forwardIndexByPortId.get(
          reversePath[r]!.portId,
        )
        if (
          sharedForwardIndex !== undefined &&
          (sharedForwardIndex < forwardLength - 1 || r < reverseLength - 1)
        ) {
          forwardLength = sharedForwardIndex + 1
          reverseLength = r + 1
          reduced = true
          break
        }
      }
      if (reduced) continue

      const forwardEnd = forwardPath[forwardLength - 1]!
      const reverseEnd = reversePath[reverseLength - 1]!
      if (
        forwardEnd.portId === reverseEnd.portId &&
        forwardEnd.prevRegionId !== undefined &&
        forwardEnd.prevRegionId === reverseEnd.prevRegionId &&
        forwardLength > 1 &&
        reverseLength > 1
      ) {
        forwardLength -= 1
        reverseLength -= 1
        continue
      }

      break
    }

    if (forwardLength === 0 || reverseLength === 0) return undefined

    const forwardEnd = forwardPath[forwardLength - 1]!
    const reverseEnd = reversePath[reverseLength - 1]!
    const portIds: PortId[] = []
    const regionIds: RegionId[] = []

    for (let i = 0; i < forwardLength; i++) {
      portIds.push(forwardPath[i]!.portId)
      if (i < forwardLength - 1) {
        regionIds.push(forwardPath[i]!.nextRegionId)
      }
    }

    let cost: number
    if (forwardEnd.portId === reverseEnd.portId) {
      const sharedPortPenalty =
        this.problem.portPenalty?.[forwardEnd.portId] ?? 0
      cost = forwardEnd.g + reverseEnd.g - sharedPortPenalty
      for (let r = reverseLength - 2; r >= 0; r--) {
        const reverseNode = reversePath[r]!
        regionIds.push(reverseNode.nextRegionId)
        portIds.push(reverseNode.portId)
      }
    } else {
      if (forwardEnd.nextRegionId !== reverseEnd.nextRegionId) {
        return undefined
      }
      const connectorG = this.computeG(forwardEnd, reverseEnd.portId)
      if (!Number.isFinite(connectorG)) return undefined
      const reverseEndPenalty =
        this.problem.portPenalty?.[reverseEnd.portId] ?? 0
      cost = connectorG + reverseEnd.g - reverseEndPenalty
      regionIds.push(forwardEnd.nextRegionId)
      portIds.push(reverseEnd.portId)
      for (let r = reverseLength - 2; r >= 0; r--) {
        const reverseNode = reversePath[r]!
        regionIds.push(reverseNode.nextRegionId)
        portIds.push(reverseNode.portId)
      }
    }

    if (
      portIds.length < 2 ||
      portIds[0] !== startPortId ||
      portIds[portIds.length - 1] !== endPortId ||
      regionIds.length + 1 !== portIds.length ||
      new Set(portIds).size !== portIds.length
    ) {
      return undefined
    }

    return {
      candidate: buildCandidateChain(portIds, regionIds, cost),
      cost,
    }
  }

  private considerBidirectionalStallJoins(
    search: ActiveBidirectionalSearch,
    candidate: Candidate,
    hopId: HopId,
    expandingForward: boolean,
  ): void {
    const oppositeFrontier = expandingForward ? search.reverse : search.forward
    const reverseMatch =
      candidate.prevRegionId !== undefined
        ? oppositeFrontier.settledByHopId.get(
            this.getHopId(candidate.portId, candidate.prevRegionId),
          )
        : undefined
    const sameHopMatch = oppositeFrontier.settledByHopId.get(hopId)
    const portMatch = oppositeFrontier.settledByPortId.get(candidate.portId)
    const regionMatches = oppositeFrontier.settledByRegionId.get(
      candidate.nextRegionId,
    )

    if (
      !reverseMatch &&
      !sameHopMatch &&
      !portMatch &&
      (!regionMatches || regionMatches.length === 0)
    ) {
      return
    }

    const seenOppositeCandidates = new Set<Candidate>()
    const tryJoinWith = (other: Candidate | undefined) => {
      if (!other || seenOppositeCandidates.has(other)) return
      seenOppositeCandidates.add(other)
      const joined = expandingForward
        ? this.buildJoinedBidirectionalStallCandidate(
            candidate,
            other,
            search.startPortId,
            search.endPortId,
          )
        : this.buildJoinedBidirectionalStallCandidate(
            other,
            candidate,
            search.startPortId,
            search.endPortId,
          )
      if (joined) {
        this.recordJoinedBidirectionalStallCandidate(search, joined)
      }
    }

    tryJoinWith(reverseMatch)
    tryJoinWith(sameHopMatch)
    tryJoinWith(portMatch)

    if (regionMatches) {
      for (const other of regionMatches) {
        tryJoinWith(other)
      }
    }
  }

  private recordBidirectionalStallDirectGoalHit(
    search: ActiveBidirectionalSearch,
    candidate: Candidate,
    directG: number,
    expandingForward: boolean,
  ): void {
    if (expandingForward) {
      const finalCandidate: Candidate = {
        portId: search.endPortId,
        prevRegionId: candidate.nextRegionId,
        nextRegionId: candidate.nextRegionId,
        prevCandidate: candidate,
        g: directG,
        h: 0,
        f: directG,
      }
      this.recordJoinedBidirectionalStallCandidate(search, {
        candidate: finalCandidate,
        cost: directG,
      })
      return
    }

    const reversePath = getCandidatePath(candidate)
    const portIds: PortId[] = [search.startPortId]
    const regionIds: RegionId[] = [candidate.nextRegionId]
    for (let r = reversePath.length - 1; r >= 0; r--) {
      const reverseNode = reversePath[r]!
      portIds.push(reverseNode.portId)
      if (r > 0) {
        regionIds.push(reversePath[r - 1]!.nextRegionId)
      }
    }

    if (
      portIds[portIds.length - 1] !== search.endPortId ||
      regionIds.length + 1 !== portIds.length ||
      new Set(portIds).size !== portIds.length
    ) {
      return
    }

    const startPortPenalty = this.problem.portPenalty?.[search.startPortId] ?? 0
    const cost = directG - startPortPenalty
    this.recordJoinedBidirectionalStallCandidate(search, {
      candidate: buildCandidateChain(portIds, regionIds, cost),
      cost,
    })
  }

  private commitBidirectionalStallPath(finalCandidate: Candidate): void {
    this.bidirectionalStallStats.solvedCount += 1
    this.clearBidirectionalStallTracking()
    this.onPathFound(finalCandidate)
  }

  private handleDisconnectedBidirectionalStallSearch(
    search: ActiveBidirectionalSearch,
    reverseFrontierEmptied: boolean,
  ): void {
    this.bidirectionalStallStats.disconnectedCount += 1
    this.clearBidirectionalStallTracking()

    if (reverseFrontierEmptied && search.allowReverseBlockerFlip) {
      this.bidirectionalStallStats.reverseBlockerFlipCount += 1
      this.bidirectionalStallFlippedBlockerRouteId = search.routeId
      try {
        super.onOutOfCandidates()
      } finally {
        this.bidirectionalStallFlippedBlockerRouteId = undefined
      }
      return
    }

    super.onOutOfCandidates()
  }

  private stepBidirectionalStallSearch(): void {
    const search = this.bidirectionalStallSearch
    if (!search) return

    if (search.remainingPostMeetingExpansions !== undefined) {
      if (search.remainingPostMeetingExpansions <= 0 && search.bestJoined) {
        this.commitBidirectionalStallPath(search.bestJoined.candidate)
        return
      }
      search.remainingPostMeetingExpansions -= 1
    }

    // Pohl's cardinality criterion always advances the smaller frontier, so a
    // boxed-in endpoint expands out of its local pocket in O(pocket) steps
    // instead of letting the open-board frontier exhaust the iteration budget.
    const expandForward =
      search.forward.queue.length <= search.reverse.queue.length
    const frontier = expandForward ? search.forward : search.reverse
    const current = this.dequeueFreshBidirectionalStallCandidate(frontier)

    if (!current) {
      if (search.bestJoined) {
        this.commitBidirectionalStallPath(search.bestJoined.candidate)
        return
      }
      this.handleDisconnectedBidirectionalStallSearch(search, !expandForward)
      return
    }

    if (this.isRegionReservedForDifferentNet(current.nextRegionId)) {
      return
    }

    const currentHopId =
      current.hopId ?? this.getHopId(current.portId, current.nextRegionId)
    this.recordSettledBidirectionalStallCandidate(
      frontier,
      currentHopId,
      current,
    )
    this.considerBidirectionalStallJoins(
      search,
      current,
      currentHopId,
      expandForward,
    )

    const { topology, problem, state } = this
    const regionId = current.nextRegionId
    const neighbors = topology.regionIncidentPorts[regionId] ?? []
    const routeNetId = state.currentRouteNetId
    const regionCongestion = state.regionCongestionCost[regionId]!
    const currentX = topology.portX[current.portId]!
    const currentY = topology.portY[current.portId]!

    for (const neighborPortId of neighbors) {
      if (neighborPortId === current.portId) continue
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      const assignedNetId = state.portAssignment[neighborPortId]!
      if (assignedNetId !== -1 && assignedNetId !== routeNetId) continue

      if (neighborPortId === frontier.goalPortId) {
        const directG = this.computeG(current, neighborPortId)
        if (Number.isFinite(directG)) {
          this.recordBidirectionalStallDirectGoalHit(
            search,
            current,
            directG,
            expandForward,
          )
        }
        continue
      }

      if (problem.portSectionMask[neighborPortId] === 0) continue

      const incidentRegions = topology.incidentPortRegion[neighborPortId]
      if (!incidentRegions) continue
      const nextRegionId =
        incidentRegions[0] === regionId
          ? incidentRegions[1]
          : incidentRegions[0]
      if (nextRegionId === undefined) continue
      if (this.isRegionReservedForDifferentNet(nextRegionId)) continue

      const nextHopId = this.getHopId(neighborPortId, nextRegionId)
      if (frontier.closedHopIds.has(nextHopId)) continue

      const previousBestCost =
        frontier.bestCostByHopId.get(nextHopId) ?? Number.POSITIVE_INFINITY
      if (current.g >= previousBestCost) continue

      const neighborX = topology.portX[neighborPortId]!
      const neighborY = topology.portY[neighborPortId]!
      const segDx = currentX - neighborX
      const segDy = currentY - neighborY
      const segmentDistance = Math.sqrt(segDx * segDx + segDy * segDy)
      const lowerBound =
        current.g +
        regionCongestion +
        (problem.portPenalty?.[neighborPortId] ?? 0) +
        (this.ADD_SEGMENT_DISTANCE_TO_G
          ? segmentDistance * this.DISTANCE_TO_COST
          : 0)
      if (lowerBound >= previousBestCost) continue

      if (pathContainsPort(current, neighborPortId)) continue

      const g = this.computeG(
        current,
        neighborPortId,
        previousBestCost,
        segmentDistance,
      )
      if (!Number.isFinite(g) || g >= previousBestCost) continue

      const goalDx = neighborX - frontier.goalX
      const goalDy = neighborY - frontier.goalY
      const h =
        Math.sqrt(goalDx * goalDx + goalDy * goalDy) * this.DISTANCE_TO_COST

      frontier.bestCostByHopId.set(nextHopId, g)
      frontier.queue.queue({
        hopId: nextHopId,
        prevRegionId: regionId,
        nextRegionId,
        portId: neighborPortId,
        g,
        h,
        f: g + h,
        prevCandidate: current,
      })
    }
  }
}

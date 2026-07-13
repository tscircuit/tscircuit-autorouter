import { NodeWithPortPoints, PortPoint } from "@tscircuit/high-density-a01"
import { HyperGraphSolver, RegionPortAssignment } from "@tscircuit/hypergraph"
import { distance, pointToSegmentDistance } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import type { CapacityMeshNodeId } from "lib/types"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { assertDefined } from "./assertDefined"
import { doRegionPortPairsCross } from "./doRegionPortPairsCross"
import { mergeGraphicsArray } from "./mergeGraphicsArray"
import type {
  CandidateHg,
  ConnectionHg,
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionId,
  RegionMemoryPfMap,
  RegionPortHg,
  RegionRipCountMap,
  SolvedRoutesHg,
} from "./types"
import { visualizeCandidate } from "./visualize/visualizeCandidate"
import { visualizeHgConnections } from "./visualize/visualizeHgConnections"
import { visualizeHgHyperGraph } from "./visualize/visualizeHgHyperGraph"
import { visualizeSolvedRoute } from "./visualize/visualizeSolvedRoute"

/** Solves port-point routing over an HG hypergraph using heuristics and optional ripping. */
export class HgPortPointPathingSolver extends HyperGraphSolver<
  RegionHg,
  RegionPortHg
> {
  private regionMemoryPfMap: RegionMemoryPfMap
  private baseRegionFailureCostMap: Map<RegionId, number>
  private regionRipCountMap: RegionRipCountMap
  private totalRipCount: number
  private hasOffBoardRegions: boolean
  private topologyHopDistanceByRegionId = new Map<RegionId, number>()
  private topologyHopDistanceEndRegionId?: RegionId
  private bestQueuedGByVisitedKey = new Map<string, number>()
  private queuedStateConnection?: ConnectionHg
  private ripHistoryByConnectionPortKey = new Map<string, number>()
  private conflictHistoryByConnectionPairKey = new Map<string, number>()
  constructor(private params: HgPortPointPathingSolverParams) {
    super({
      inputConnections: params.connections,
      inputGraph: params.graph,
      inputSolvedRoutes: params.inputSolvedRoutes,
      greedyMultiplier: params.weights.GREEDY_MULTIPLIER,
      ripCost: params.weights.RIPPING_PF_COST,
      rippingEnabled: params.flags.RIPPING_ENABLED,
    })
    this.regionMemoryPfMap = params.opts?.regionMemoryPfMap ?? new Map()
    this.baseRegionFailureCostMap = new Map()
    this.regionRipCountMap = new Map()
    this.totalRipCount = 0
    this.hasOffBoardRegions = params.graph.regions.some((region) =>
      Boolean(region.d._offBoardConnectionId),
    )
    if (params.weights.MAX_ITERATIONS_PER_PATH > 0) {
      this.MAX_ITERATIONS =
        params.weights.MAX_ITERATIONS_PER_PATH *
        params.effort *
        Math.max(1, params.connections.length)
    }
  }

  override estimateCostToEnd(port: RegionPortHg): number {
    const endRegion = this.currentEndRegion
    assertDefined(endRegion, "Current end region is undefined")
    return distance(port.d, endRegion.d.center)
  }

  override computeH(candidate: CandidateHg): number {
    if (this.params.flags.USE_TOPOLOGY_ONLY_HEURISTIC) {
      return (
        this.getTopologyHopDistanceToEnd(candidate.nextRegion) *
        (this.params.weights.TOPOLOGY_HEURISTIC_COST ??
          this.params.weights.TOPOLOGY_STEP_COST ??
          0)
      )
    }

    const hgCandidate = candidate as CandidateHg
    const distanceTraveled = this.computeDistanceTraveled(hgCandidate)
    if (
      this.params.weights.RANDOM_WALK_DISTANCE > 0 &&
      distanceTraveled < this.params.weights.RANDOM_WALK_DISTANCE
    ) {
      return 0
    }

    const distanceToEnd = this.estimateCostToEnd(candidate.port)
    const centeredOffset =
      candidate.port.d.distToCentermostPortOnZ -
      this.params.weights.CENTER_OFFSET_FOCUS_SHIFT
    const centerOffsetPenalty =
      centeredOffset * this.params.weights.CENTER_OFFSET_DIST_PENALTY_FACTOR
    const regionIdForMemoryPf =
      candidate.nextRegion?.regionId ?? candidate.lastRegion?.regionId
    const memoryPf = regionIdForMemoryPf
      ? (this.regionMemoryPfMap.get(regionIdForMemoryPf) ?? 0)
      : 0
    const memoryPfPenalty = this.computeMemoryPfPenalty(memoryPf)
    const straightLineDeviationPenalty =
      this.computeDeviation(candidate) *
      this.params.weights.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR

    return (
      distanceToEnd +
      centerOffsetPenalty +
      memoryPfPenalty +
      straightLineDeviationPenalty
    )
  }

  private getTopologyHopDistanceToEnd(region?: RegionHg): number {
    const endRegion = this.currentEndRegion
    assertDefined(endRegion, "Current end region is undefined")
    if (!region) return 0

    if (this.topologyHopDistanceEndRegionId !== endRegion.regionId) {
      this.topologyHopDistanceByRegionId.clear()
      this.topologyHopDistanceEndRegionId = endRegion.regionId
      this.topologyHopDistanceByRegionId.set(endRegion.regionId, 0)
      const queue: RegionHg[] = [endRegion]

      while (queue.length > 0) {
        const currentRegion = queue.shift()!
        const currentDistance =
          this.topologyHopDistanceByRegionId.get(currentRegion.regionId) ?? 0
        for (const port of currentRegion.ports) {
          const adjacentRegion =
            port.region1 === currentRegion ? port.region2 : port.region1
          if (this.topologyHopDistanceByRegionId.has(adjacentRegion.regionId)) {
            continue
          }
          this.topologyHopDistanceByRegionId.set(
            adjacentRegion.regionId,
            currentDistance + 1,
          )
          queue.push(adjacentRegion)
        }
      }
    }

    return this.topologyHopDistanceByRegionId.get(region.regionId) ?? 0
  }

  override computeIncreasedRegionCostIfPortsAreUsed(
    region: RegionHg,
    port1: RegionPortHg,
    port2: RegionPortHg,
  ): number {
    const currentConnection = this.currentConnection
    assertDefined(currentConnection, "Current connection is undefined")

    const crossingAssignments = this.getRipsRequiredForPortUsage(
      region,
      port1,
      port2,
    )
    if (
      !region.d._offBoardConnectionId &&
      this.params.weights.CROSSING_PENALTY !== undefined
    ) {
      return crossingAssignments.reduce((cost, assignment) => {
        const conflictCount = this.getConnectionPairConflictCount(
          currentConnection.connectionId,
          assignment.connection.connectionId,
        )
        return (
          cost +
          this.params.weights.CROSSING_PENALTY! +
          conflictCount * (this.params.weights.CONFLICT_HISTORY_COST ?? 0)
        )
      }, 0)
    }
    const baseCost = this.getBaseRegionFailureCost(region)
    const pfAfter = this.computeRegionPfWithAdditionalSegment(
      region,
      port1,
      port2,
      currentConnection.connectionId,
      currentConnection.mutuallyConnectedNetworkId,
    )
    if (pfAfter >= this.NODE_MAX_PF) {
      return this.params.weights.NODE_PF_MAX_PENALTY
    }
    const afterCost = this.pfToFailureCost(pfAfter)
    const delta = Math.max(0, afterCost - baseCost)
    return Math.min(
      this.params.weights.NODE_PF_MAX_PENALTY,
      delta * this.params.weights.NODE_PF_FACTOR,
    )
  }

  override computeG(candidate: CandidateHg): number {
    const hgCandidate = candidate
    let baseCost =
      super.computeG(candidate) + (this.params.weights.TOPOLOGY_STEP_COST ?? 0)
    if (
      hgCandidate.lastPort &&
      hgCandidate.lastPort.d.z !== hgCandidate.port.d.z
    ) {
      baseCost += this.params.weights.LAYER_CHANGE_COST
    }
    if (hgCandidate.nextRegion !== this.currentEndRegion) {
      return baseCost
    }
    return baseCost + this.computeEndRegionCloseCost(hgCandidate)
  }

  private getCandidateVisitedKey(candidate: CandidateHg): string {
    const offBoardConnectionCount =
      this.getCandidateOffBoardConnectionIds(candidate).size
    return `${candidate.port.portId}:offboard-count=${offBoardConnectionCount}`
  }

  private getCandidateOffBoardConnectionIds(
    candidate: CandidateHg,
  ): Set<string> {
    const offBoardConnectionIds = new Set<string>()
    let cursor: CandidateHg | undefined = candidate
    while (cursor) {
      const offBoardConnectionId = cursor.lastRegion?.d._offBoardConnectionId
      if (offBoardConnectionId) {
        offBoardConnectionIds.add(offBoardConnectionId)
      }
      cursor = cursor.parent
    }
    return offBoardConnectionIds
  }

  /**
   * The base hypergraph solver closes a port after its first visit. A prefab
   * connection changes the routing state, so the same physical port must be
   * explored separately for each amount of prefab-connection budget used.
   * The identity of a previously used portal does not affect future moves once
   * two paths reach the same port, so retaining it would duplicate equivalent
   * states for every assignable plated-hole pair.
   */
  override _step(): void {
    if (!this.hasOffBoardRegions) {
      super._step()
      return
    }

    if (this.queuedStateConnection !== this.currentConnection) {
      this.bestQueuedGByVisitedKey.clear()
      this.queuedStateConnection = this.currentConnection ?? undefined
    }

    let currentCandidate = this.candidateQueue.dequeue() as CandidateHg | null
    if (!currentCandidate) {
      this.failed = true
      this.error = "Ran out of candidates"
      return
    }

    let visitedKey = this.getCandidateVisitedKey(currentCandidate)
    let visitedPointGScore =
      this.visitedPointsForCurrentConnection.get(visitedKey)
    while (currentCandidate && visitedPointGScore !== undefined) {
      if (currentCandidate.g < visitedPointGScore) break
      currentCandidate = this.candidateQueue.dequeue() as CandidateHg | null
      if (!currentCandidate) break
      visitedKey = this.getCandidateVisitedKey(currentCandidate)
      visitedPointGScore =
        this.visitedPointsForCurrentConnection.get(visitedKey)
    }

    if (!currentCandidate) {
      this.failed = true
      this.error = "Ran out of candidates"
      return
    }

    this.lastCandidate = currentCandidate
    this.visitedPointsForCurrentConnection.set(visitedKey, currentCandidate.g)
    if (currentCandidate.nextRegion === this.currentEndRegion) {
      this.processSolvedRoute(currentCandidate)
      if (this.unprocessedConnections.length === 0) {
        this.solved = true
        return
      }
      this.beginNewConnection()
      return
    }

    const nextCandidates = this.getNextCandidates(currentCandidate)
    for (const nextCandidate of nextCandidates) {
      const nextVisitedKey = this.getCandidateVisitedKey(nextCandidate)
      const visitedG =
        this.visitedPointsForCurrentConnection.get(nextVisitedKey)
      if (visitedG !== undefined && visitedG <= nextCandidate.g) continue
      const queuedG = this.bestQueuedGByVisitedKey.get(nextVisitedKey)
      if (queuedG !== undefined && queuedG <= nextCandidate.g) continue
      this.bestQueuedGByVisitedKey.set(nextVisitedKey, nextCandidate.g)
      this.candidateQueue.enqueue(nextCandidate)
    }
  }

  override getPortUsagePenalty(port: RegionPortHg): number {
    const currentConnectionId = this.currentConnection?.connectionId ?? ""
    const ripHistoryPenalty =
      (this.ripHistoryByConnectionPortKey.get(
        `${currentConnectionId}:${port.portId}`,
      ) ?? 0) * (this.params.weights.RIP_HISTORY_COST ?? 0)
    const assignment = port.assignment
    if (!assignment) return ripHistoryPenalty

    const currentNetId = this.currentConnection?.mutuallyConnectedNetworkId
    if (assignment.connection.mutuallyConnectedNetworkId === currentNetId) {
      return ripHistoryPenalty
    }

    // Discourage reusing a port that is already occupied by a different net.
    return (
      ripHistoryPenalty +
      Math.max(1, this.params.weights.NODE_PF_FACTOR) * 0.5 +
      this.params.weights.BASE_CANDIDATE_COST
    )
  }

  override ripSolvedRoute(solvedRoute: SolvedRoutesHg): void {
    const connectionId = solvedRoute.connection.connectionId
    for (const candidate of solvedRoute.path) {
      const key = `${connectionId}:${candidate.port.portId}`
      this.ripHistoryByConnectionPortKey.set(
        key,
        (this.ripHistoryByConnectionPortKey.get(key) ?? 0) + 1,
      )
    }
    super.ripSolvedRoute(solvedRoute)
  }

  private getConnectionPairKey(
    connectionId1: string,
    connectionId2: string,
  ): string {
    return [connectionId1, connectionId2].sort().join("::")
  }

  private getConnectionPairConflictCount(
    connectionId1: string,
    connectionId2: string,
  ): number {
    return (
      this.conflictHistoryByConnectionPairKey.get(
        this.getConnectionPairKey(connectionId1, connectionId2),
      ) ?? 0
    )
  }

  override getRipsRequiredForPortUsage(
    region: RegionHg,
    port1: RegionPortHg,
    port2: RegionPortHg,
  ): RegionPortAssignment[] {
    const assignment: RegionPortAssignment[] = region.assignments ?? []
    if (assignment.length === 0) return []

    if (region.d._offBoardConnectionId) {
      return assignment.filter(
        (assignment) =>
          assignment.connection.mutuallyConnectedNetworkId !==
          this.currentConnection?.mutuallyConnectedNetworkId,
      )
    }

    const ripsRequired: RegionPortAssignment[] = assignment.filter(
      (assignment) => {
        if (
          !this.params.flags.ALWAYS_RIP_SAME_NET_INTERSECTIONS &&
          assignment.connection.mutuallyConnectedNetworkId ===
            this.currentConnection?.mutuallyConnectedNetworkId
        ) {
          return false
        }

        if (
          assignment.regionPort1 === port1 ||
          assignment.regionPort2 === port1
        ) {
          return false
        }

        if (
          assignment.regionPort1 === port2 ||
          assignment.regionPort2 === port2
        ) {
          return false
        }

        return doRegionPortPairsCross(
          region,
          port1,
          port2,
          assignment.regionPort1,
          assignment.regionPort2,
        )
      },
    )

    return ripsRequired
  }

  override isRipRequiredForPortUsage(
    region: RegionHg,
    port1: RegionPortHg,
    port2: RegionPortHg,
  ): boolean {
    if (!region.d._offBoardConnectionId) return false
    return this.getRipsRequiredForPortUsage(region, port1, port2).length > 0
  }

  override selectCandidatesForEnteringRegion(
    candidates: CandidateHg[],
  ): CandidateHg[] {
    const startRegion = this.currentConnection?.startRegion
    const endRegion = this.currentConnection?.endRegion
    assertDefined(
      startRegion,
      "Current connection or start region is undefined",
    )
    assertDefined(endRegion, "Current connection or end region is undefined")

    const filterCandidates = candidates.filter((candidate) => {
      const nextRegion = candidate.nextRegion
      if (
        nextRegion &&
        this.candidateAlreadyVisitedRegion(candidate, nextRegion)
      ) {
        return false
      }
      const maxOffBoardConnections =
        this.params.flags.MAX_OFF_BOARD_CONNECTIONS_PER_PATH ?? Infinity
      if (
        this.getCandidateOffBoardConnectionIds(candidate).size >
        maxOffBoardConnections
      ) {
        return false
      }
      if (!nextRegion?.d._containsObstacle) {
        return true
      }
      return nextRegion === startRegion || nextRegion === endRegion
    })

    let centerFirstCandidates = this.params.flags.FORCE_CENTER_FIRST
      ? this.getCenterFirstEnteringRegionCandidates(filterCandidates)
      : filterCandidates

    const maxAllowedCost = -this.params.weights.MIN_ALLOWED_BOARD_SCORE
    if (maxAllowedCost > 0) {
      const affordableCandidates = centerFirstCandidates.filter(
        (candidate) => candidate.g + candidate.h <= maxAllowedCost,
      )
      if (affordableCandidates.length > 0) {
        centerFirstCandidates = affordableCandidates
      }
    }

    return centerFirstCandidates
  }

  private candidateAlreadyVisitedRegion(
    candidate: CandidateHg,
    region: RegionHg,
  ): boolean {
    let cursor = candidate.parent
    while (cursor) {
      if (cursor.lastRegion === region || cursor.nextRegion === region) {
        return true
      }
      cursor = cursor.parent
    }
    return false
  }

  override routeSolvedHook(solvedRoute: SolvedRoutesHg): void {
    this.baseRegionFailureCostMap.clear()
    const traversedRegions = new Set<RegionHg>()
    for (const candidate of solvedRoute.path) {
      const region = candidate.lastRegion
      if (region) traversedRegions.add(region)
    }
    for (const region of traversedRegions) {
      const regionPf = this.computeRegionPfFromAssignments(region)
      this.regionMemoryPfMap.set(region.regionId, regionPf)
    }

    if (!solvedRoute.requiredRip) return
    if (this.unprocessedConnections.length < 2) return

    // TODO: not sure if we need to do this
    const [next, ...rest] = this.unprocessedConnections
    this.unprocessedConnections = [...rest, next]
  }

  override computeRoutesToRip(
    newlySolvedRoute: SolvedRoutesHg,
  ): Set<SolvedRoutesHg> {
    const portOverlapRoutesToRip = super.computePortOverlapRoutes(
      newlySolvedRoute,
    )
    const crossingRoutesToRip = this.params.flags.ALWAYS_RIP_INTERSECTIONS
      ? super.computeCrossingRoutes(newlySolvedRoute)
      : new Set<SolvedRoutesHg>()
    const requiredRoutesToRip = new Set<SolvedRoutesHg>([
      ...portOverlapRoutesToRip,
      ...crossingRoutesToRip,
    ])
    for (const routeToRip of crossingRoutesToRip) {
      const pairKey = this.getConnectionPairKey(
        newlySolvedRoute.connection.connectionId,
        routeToRip.connection.connectionId,
      )
      this.conflictHistoryByConnectionPairKey.set(
        pairKey,
        (this.conflictHistoryByConnectionPairKey.get(pairKey) ?? 0) + 1,
      )
    }
    const routesToRip = new Set<SolvedRoutesHg>(requiredRoutesToRip)

    if (this.params.weights.CROSSING_PENALTY !== undefined) {
      return routesToRip
    }

    const crossingRoutesByRegion: Map<RegionHg, Set<SolvedRoutesHg>> = new Map()
    newlySolvedRoute.path.map((candidate) => {
      if (!candidate.lastPort || !candidate.lastRegion) return
      const crossingAssignments = this.getRipsRequiredForPortUsage(
        candidate.lastRegion,
        candidate.lastPort,
        candidate.port,
      )
      if (crossingAssignments.length === 0) return null
      const crossingRoutesInRegion =
        crossingRoutesByRegion.get(candidate.lastRegion) ?? new Set()
      for (const assignment of crossingAssignments) {
        crossingRoutesInRegion.add(assignment.solvedRoute)
      }
      crossingRoutesByRegion.set(candidate.lastRegion, crossingRoutesInRegion)
    })
    const traversedRegions = newlySolvedRoute.path.flatMap((candidate) => {
      if (!candidate.lastRegion) return []
      return [candidate.lastRegion]
    })

    const allRegionIdsForRipping = Array.from(
      new Set<RegionHg>([
        ...crossingRoutesByRegion.keys(),
        ...traversedRegions,
      ]),
    )
    const rippingRandomSeed =
      this.params.weights.SHUFFLE_SEED +
      this.iterations +
      this.solvedRoutes.length +
      this.totalRipCount
    const orderedRegionIdsForRipping = cloneAndShuffleArray(
      allRegionIdsForRipping,
      rippingRandomSeed,
    )
    for (const region of orderedRegionIdsForRipping) {
      if (this.totalRipCount >= this.params.weights.MAX_RIPS) break
      const rippingThreshold = this.getRegionRippingPfThreshold(region.regionId)
      let currentPf = this.computeRegionPf({
        region,
        newlySolvedRoute,
        routesToRip,
      })
      this.regionMemoryPfMap.set(region.regionId, currentPf)

      if (currentPf <= rippingThreshold) continue

      const testedConnection = new Set<ConnectionHg>()
      let ripCountForRegionLoop = 0

      while (currentPf > rippingThreshold) {
        if (this.totalRipCount >= this.params.weights.MAX_RIPS) break
        if (!region.assignments || region.assignments.length === 0) {
          throw new Error(
            "We are trying to rip a region with no assignments, this should not happen",
          )
        }

        const availableRoutesToRegion = region.assignments
          .map((e) => {
            const route = e.solvedRoute
            const routeConnection = e.connection
            if (
              routeConnection.connectionId ===
              newlySolvedRoute.connection.connectionId
            ) {
              return null
            }
            if (!routesToRip.has(route)) {
              return route
            }
          })
          .filter((route) => !!route)

        if (availableRoutesToRegion.length === 0) break

        const shuffledRoutesInRegion = cloneAndShuffleArray(
          availableRoutesToRegion,
          rippingRandomSeed + ripCountForRegionLoop + testedConnection.size,
        )

        const routeToRip = shuffledRoutesInRegion[0]
        if (!routeToRip) break
        testedConnection.add(routeToRip.connection)

        routesToRip.add(routeToRip)
        this.totalRipCount++
        ripCountForRegionLoop++
        this.regionRipCountMap.set(
          region.regionId,
          (this.regionRipCountMap.get(region.regionId) ?? 0) + 1,
        )

        currentPf = this.computeRegionPf({
          region,
          newlySolvedRoute,
          routesToRip,
        })
        this.regionMemoryPfMap.set(region.regionId, currentPf)
      }
    }
    const didRipAnyLoop = routesToRip.size > requiredRoutesToRip.size
    if (didRipAnyLoop) {
      if (this.totalRipCount >= this.params.weights.MAX_RIPS) return routesToRip

      const eligibleRoutes = this.solvedRoutes.filter((route) => {
        if (routesToRip.has(route)) return false
        return (
          route.connection.connectionId !==
          newlySolvedRoute.connection.connectionId
        )
      })

      if (eligibleRoutes.length === 0) return routesToRip

      const randomRipCount = Math.max(
        1,
        Math.floor(
          this.params.weights.RANDOM_RIP_FRACTION * eligibleRoutes.length,
        ),
      )
      const shuffledEligibleRoutes = cloneAndShuffleArray(
        eligibleRoutes,
        rippingRandomSeed,
      )

      let addedRandomRips = 0
      for (const route of shuffledEligibleRoutes) {
        if (addedRandomRips >= randomRipCount) break
        if (this.totalRipCount >= this.params.weights.MAX_RIPS) break
        if (routesToRip.has(route)) continue

        routesToRip.add(route)
        addedRandomRips++
        this.totalRipCount++
      }
    }

    return routesToRip
  }

  private computeDeviation(candidate: CandidateHg) {
    const startPoint = this.currentConnection?.startRegion.d.center
    const endPoint = this.currentConnection?.endRegion.d.center
    assertDefined(startPoint, "Current connection or start region is undefined")
    assertDefined(endPoint, "Current connection or end region is undefined")
    const portPoint = candidate.port.d
    const deviation = pointToSegmentDistance(portPoint, startPoint, endPoint)
    return deviation
  }

  private computeDistanceTraveled(candidate: CandidateHg): number {
    let distanceTraveled = 0
    let currentCandidate: CandidateHg | undefined = candidate
    while (currentCandidate?.parent) {
      distanceTraveled += distance(
        currentCandidate.parent.port.d,
        currentCandidate.port.d,
      )
      currentCandidate = currentCandidate.parent
    }
    return distanceTraveled
  }

  private computeMemoryPfPenalty(memoryPf: number): number {
    const clampedPf = Math.min(Math.max(memoryPf, 0), 0.999999)
    const failureCost = Math.min(
      this.params.weights.NODE_PF_MAX_PENALTY,
      -Math.log(1 - clampedPf),
    )

    return (
      failureCost * this.params.weights.MEMORY_PF_FACTOR +
      failureCost * this.params.weights.NODE_PF_FACTOR * 0.01
    )
  }

  private computeEndRegionCloseCost(candidate: CandidateHg): number {
    const currentConnection = this.currentConnection
    const endRegion = this.currentEndRegion
    assertDefined(currentConnection, "Current connection is undefined")
    assertDefined(endRegion, "Current end region is undefined")

    const endPoint = currentConnection.endRegion.d.center

    const endTargetPort: RegionPortHg = {
      portId: `end-target:${currentConnection.connectionId}`,
      region1: endRegion,
      region2: endRegion,
      d: {
        portId: `end-target:${currentConnection.connectionId}`,
        x: endPoint.x,
        y: endPoint.y,
        z: candidate.port.d.z,
        distToCentermostPortOnZ: 0,
        regions: [endRegion, endRegion],
      },
    }

    return this.computeIncreasedRegionCostIfPortsAreUsed(
      endRegion,
      candidate.port,
      endTargetPort,
    )
  }

  private getCenterFirstEnteringRegionCandidates(
    candidates: CandidateHg[],
  ): CandidateHg[] {
    const byZ = new Map<number, CandidateHg[]>()
    for (const candidate of candidates) {
      const z = candidate.port.d.z
      const candidatesOnZ = byZ.get(z) ?? []
      candidatesOnZ.push(candidate)
      byZ.set(z, candidatesOnZ)
    }

    const selected: CandidateHg[] = []

    for (const candidatesOnZ of byZ.values()) {
      const sortedByCenterOffsetCandidates = candidatesOnZ.sort(
        (a, b) =>
          a.port.d.distToCentermostPortOnZ - b.port.d.distToCentermostPortOnZ,
      )
      const currentCandidate = sortedByCenterOffsetCandidates[0]
      if (!currentCandidate) continue

      if (this.isPortAvailableForCurrentNet(currentCandidate.port)) {
        selected.push(currentCandidate)
        continue
      }

      const sortedByPositionCandidates = candidatesOnZ.sort((a, b) => {
        if (a.port.d.x !== b.port.d.x) {
          return a.port.d.x - b.port.d.x
        }
        return a.port.d.y - b.port.d.y
      })

      const availableRangesCandidate: CandidateHg[][] = []
      let currentRangeCandidate: CandidateHg[] = []

      for (const candidate of sortedByPositionCandidates) {
        if (this.isPortAvailableForCurrentNet(candidate.port)) {
          currentRangeCandidate.push(candidate)
          continue
        }

        if (currentRangeCandidate.length > 0) {
          availableRangesCandidate.push(currentRangeCandidate)
          currentRangeCandidate = []
        }
      }

      if (currentRangeCandidate.length > 0) {
        availableRangesCandidate.push(currentRangeCandidate)
      }

      for (const range of availableRangesCandidate) {
        selected.push(range[Math.floor(range.length / 2)])
      }
    }

    return selected
  }

  private isPortAvailableForCurrentNet(port: RegionPortHg): boolean {
    const assignment = port.assignment
    if (!assignment) return true

    const currentNetId = this.currentConnection?.mutuallyConnectedNetworkId
    return assignment.connection.mutuallyConnectedNetworkId === currentNetId
  }

  private computeRegionPfFromAssignments(region: RegionHg): number {
    if (region.d._offBoardConnectionId) return 0

    const existingPortPoints = this.getRegionAssignedPortPoints(region)

    const nodeWithPortPoints: NodeWithPortPoints = {
      ...region.d,
      portPoints: existingPortPoints,
    }

    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
    const capacityMeshNode = region.d

    return calculateNodeProbabilityOfFailure(
      capacityMeshNode,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  private clampPf(pf: number): number {
    return Math.min(Math.max(pf, 0), 0.999999)
  }

  private get NODE_MAX_PF() {
    return Math.min(
      0.99999,
      1 - Math.exp(-this.params.weights.NODE_PF_MAX_PENALTY),
    )
  }

  private pfToFailureCost(pf: number): number {
    const p = this.clampPf(pf)
    if (p >= this.NODE_MAX_PF) return this.params.weights.NODE_PF_MAX_PENALTY
    return -Math.log(1 - p)
  }

  private getBaseRegionFailureCost(region: RegionHg): number {
    const cached = this.baseRegionFailureCostMap.get(region.regionId)
    if (cached != null) return cached
    const pfBefore = this.computeRegionPfFromAssignments(region)
    const baseCost = this.pfToFailureCost(pfBefore)
    this.baseRegionFailureCostMap.set(region.regionId, baseCost)
    return baseCost
  }

  private getRegionAssignedPortPoints(
    region: RegionHg,
    routesToExclude: Set<SolvedRoutesHg> = new Set(),
  ): PortPoint[] {
    const existingAssignments = (region.assignments ?? []).filter(
      (assignment) =>
        !routesToExclude.has(assignment.solvedRoute as SolvedRoutesHg),
    )
    return existingAssignments.flatMap((assignment) => {
      const region1PortPoint = assignment.regionPort1.d
      const region2PortPoint = assignment.regionPort2.d
      const connectionName = assignment.connection.connectionId
      const rootConnectionName =
        assignment.connection.mutuallyConnectedNetworkId
      return [
        {
          x: region1PortPoint.x,
          y: region1PortPoint.y,
          z: region1PortPoint.z,
          connectionName,
          rootConnectionName,
        },
        {
          x: region2PortPoint.x,
          y: region2PortPoint.y,
          z: region2PortPoint.z,
          connectionName,
          rootConnectionName,
        },
      ] as PortPoint[]
    })
  }

  private computeRegionPfWithAdditionalSegment(
    region: RegionHg,
    port1: RegionPortHg,
    port2: RegionPortHg,
    connectionName: string,
    rootConnectionName?: string,
    routesToExclude: Set<SolvedRoutesHg> = new Set(),
  ): number {
    if (region.d._offBoardConnectionId) return 0

    const existingPortPoints = this.getRegionAssignedPortPoints(
      region,
      routesToExclude,
    )
    const additionalPortPoints: PortPoint[] = [
      {
        x: port1.d.x,
        y: port1.d.y,
        z: port1.d.z,
        connectionName,
        rootConnectionName,
      },
      {
        x: port2.d.x,
        y: port2.d.y,
        z: port2.d.z,
        connectionName,
        rootConnectionName,
      },
    ]

    const nodeWithPortPoints: NodeWithPortPoints = {
      ...region.d,
      portPoints: [...existingPortPoints, ...additionalPortPoints],
    }
    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)

    return calculateNodeProbabilityOfFailure(
      region.d,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  private getRegionRippingPfThreshold(regionId: RegionId): number {
    const regionRipCount = this.regionRipCountMap.get(regionId) ?? 0
    const maxRegionRips = Math.max(
      1,
      Math.floor(this.params.weights.MAX_RIPS / 10),
    )
    const regionRipFraction = Math.min(1, regionRipCount / maxRegionRips)
    const startRippingPfThreshold =
      this.params.weights.START_RIPPING_PF_THRESHOLD || 0.3
    const endRippingPfThreshold =
      this.params.weights.END_RIPPING_PF_THRESHOLD || 1
    const threshold =
      startRippingPfThreshold * (1 - regionRipFraction) +
      endRippingPfThreshold * regionRipFraction
    return threshold
  }

  private computeRegionPf({
    region,
    newlySolvedRoute,
    routesToRip,
  }: {
    region: RegionHg
    newlySolvedRoute: SolvedRoutesHg
    routesToRip: Set<SolvedRoutesHg>
  }): number {
    if (region.d._offBoardConnectionId) return 0

    const existingAssignments = (region.assignments ?? []).filter(
      (assignment) => !routesToRip.has(assignment.solvedRoute),
    )
    const existingPortPoints = existingAssignments.flatMap((assignment) => {
      const regionPort1 = assignment.regionPort1
      const regionPort2 = assignment.regionPort2
      const connectionName = assignment.connection.connectionId
      const rootConnectionName =
        assignment.connection.mutuallyConnectedNetworkId
      return [
        {
          x: regionPort1.d.x,
          y: regionPort1.d.y,
          z: regionPort1.d.z,
          connectionName,
          rootConnectionName,
        },
        {
          x: regionPort2.d.x,
          y: regionPort2.d.y,
          z: regionPort2.d.z,
          connectionName,
          rootConnectionName,
        },
      ] as PortPoint[]
    })
    const newlySolvedRoutePortPoints = newlySolvedRoute.path.flatMap(
      (candidate) => {
        if (!candidate.lastPort || candidate.lastRegion !== region) {
          return []
        }

        const lastPort = candidate.lastPort
        const currentPort = candidate.port

        return [
          {
            x: lastPort.d.x,
            y: lastPort.d.y,
            z: lastPort.d.z,
            connectionName: newlySolvedRoute.connection.connectionId,
            rootConnectionName:
              newlySolvedRoute.connection.mutuallyConnectedNetworkId,
          },
          {
            x: currentPort.d.x,
            y: currentPort.d.y,
            z: currentPort.d.z,
            connectionName: newlySolvedRoute.connection.connectionId,
            rootConnectionName:
              newlySolvedRoute.connection.mutuallyConnectedNetworkId,
          },
        ] as PortPoint[]
      },
    )

    const portPoints = [...existingPortPoints, ...newlySolvedRoutePortPoints]

    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: region.d.capacityMeshNodeId,
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      portPoints,
      availableZ: region.d.availableZ,
    }
    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
    const capacityMeshNode = region.d

    const pf = calculateNodeProbabilityOfFailure(
      capacityMeshNode,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )

    return pf
  }

  computeNodePf(node: InputNodeWithPortPoints): number | null {
    const solvedNode = this.getOutput().nodesWithPortPoints.find(
      (candidate) => candidate.capacityMeshNodeId === node.capacityMeshNodeId,
    )
    const region = this.params.graph.regions.find(
      (candidate) => candidate.d.capacityMeshNodeId === node.capacityMeshNodeId,
    )

    if (!solvedNode || !region) return null

    const crossings = getIntraNodeCrossingsUsingCircle(solvedNode)

    return calculateNodeProbabilityOfFailure(
      region.d,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  override getOutput(): {
    nodesWithPortPoints: NodeWithPortPoints[]
    inputNodeWithPortPoints: InputNodeWithPortPoints[]
  } {
    const regionById = new Map(
      this.params.graph.regions.map((region) => [region.regionId, region]),
    )
    const endpointRegionIds = new Set<RegionId>()
    for (const connection of this.params.connections) {
      endpointRegionIds.add(connection.startRegion.regionId)
      endpointRegionIds.add(connection.endRegion.regionId)
    }
    const endpointPortPointsByRegion = new Map<RegionId, PortPoint[]>()
    const endpointTargetByRegionConnectionKey = new Map<
      string,
      { x: number; y: number }
    >()
    for (const route of this.solvedRoutes) {
      const path = route.path as CandidateHg[]
      if (path.length === 0) continue
      const firstPort = path[0]?.port
      const lastPort = path[path.length - 1]?.port
      if (!firstPort || !lastPort) continue

      const connectionName = route.connection.connectionId
      const rootConnectionName = route.connection.mutuallyConnectedNetworkId

      const startRegionId = route.connection.startRegion.regionId
      const endRegionId = route.connection.endRegion.regionId
      const [startTarget, endTarget] =
        (route.connection as ConnectionHg).simpleRouteConnection
          ?.pointsToConnect ?? []
      if (startTarget) {
        endpointTargetByRegionConnectionKey.set(
          `${startRegionId}::${connectionName}::${rootConnectionName}`,
          startTarget,
        )
      }
      if (endTarget) {
        endpointTargetByRegionConnectionKey.set(
          `${endRegionId}::${connectionName}::${rootConnectionName}`,
          endTarget,
        )
      }

      const startPortPoints =
        endpointPortPointsByRegion.get(startRegionId) ?? []
      startPortPoints.push({
        portPointId: firstPort.d.portId,
        x: firstPort.d.x,
        y: firstPort.d.y,
        z: firstPort.d.z,
        connectionName,
        rootConnectionName,
      })
      endpointPortPointsByRegion.set(startRegionId, startPortPoints)

      const endPortPoints = endpointPortPointsByRegion.get(endRegionId) ?? []
      endPortPoints.push({
        portPointId: lastPort.d.portId,
        x: lastPort.d.x,
        y: lastPort.d.y,
        z: lastPort.d.z,
        connectionName,
        rootConnectionName,
      })
      endpointPortPointsByRegion.set(endRegionId, endPortPoints)
    }

    const nodesWithPortPoints: NodeWithPortPoints[] = []
    const inputNodeWithPortPoints: InputNodeWithPortPoints[] = []

    for (const region of this.params.graph.regions) {
      const assignments = region.assignments ?? []
      const edgePortPoints = assignments.flatMap((assignment) => {
        const connectionName = assignment.connection.connectionId
        const rootConnectionName =
          assignment.connection.mutuallyConnectedNetworkId
        const startPoint: PortPoint = {
          portPointId: assignment.regionPort1.d.portId,
          x: assignment.regionPort1.d.x,
          y: assignment.regionPort1.d.y,
          z: assignment.regionPort1.d.z,
          connectionName,
          rootConnectionName,
          nextPortPointId: assignment.regionPort2.d.portId,
        }
        const endPoint: PortPoint = {
          portPointId: assignment.regionPort2.d.portId,
          x: assignment.regionPort2.d.x,
          y: assignment.regionPort2.d.y,
          z: assignment.regionPort2.d.z,
          connectionName,
          rootConnectionName,
          prevPortPointId: assignment.regionPort1.d.portId,
        }

        return [startPoint, endPoint] as PortPoint[]
      })

      const centerPortPoints: PortPoint[] = []
      if (
        region.d._containsObstacle &&
        endpointRegionIds.has(region.regionId)
      ) {
        const endpointPortPoints =
          endpointPortPointsByRegion.get(region.regionId) ?? []
        const supplementalEndpointPortPoints: PortPoint[] = []
        for (const endpointPort of endpointPortPoints) {
          const alreadyExists = edgePortPoints.some(
            (p) =>
              p.connectionName === endpointPort.connectionName &&
              p.rootConnectionName === endpointPort.rootConnectionName &&
              p.portPointId === endpointPort.portPointId,
          )
          if (!alreadyExists) {
            supplementalEndpointPortPoints.push(endpointPort)
          }
        }
        edgePortPoints.push(...supplementalEndpointPortPoints)

        const edgePortPointsByConnection = new Map<string, PortPoint[]>()
        for (const portPoint of edgePortPoints) {
          const key = `${portPoint.connectionName}::${portPoint.rootConnectionName ?? ""}`
          const points = edgePortPointsByConnection.get(key) ?? []
          points.push(portPoint)
          edgePortPointsByConnection.set(key, points)
        }

        for (const [key, points] of edgePortPointsByConnection.entries()) {
          const [connectionName, rootConnectionName = ""] = key.split("::")
          const firstPoint = points[0]
          if (!firstPoint) continue
          const endpointTarget = endpointTargetByRegionConnectionKey.get(
            `${region.regionId}::${connectionName}::${rootConnectionName}`,
          )
          const centerPortPoint: PortPoint = {
            portPointId: `center:${region.regionId}:${connectionName}:${rootConnectionName}`,
            x: endpointTarget?.x ?? region.d.center.x,
            y: endpointTarget?.y ?? region.d.center.y,
            z: firstPoint.z,
            connectionName,
            rootConnectionName: rootConnectionName || undefined,
          }
          if (points.length >= 2) {
            const lastPoint = points[points.length - 1]!
            if (firstPoint.portPointId) {
              firstPoint.nextPortPointId = centerPortPoint.portPointId
              centerPortPoint.prevPortPointId = firstPoint.portPointId
            }
            if (lastPoint.portPointId) {
              lastPoint.prevPortPointId = centerPortPoint.portPointId
              centerPortPoint.nextPortPointId = lastPoint.portPointId
            }
          }
          centerPortPoints.push(centerPortPoint)
        }
      }

      const nodePortPoints = [...edgePortPoints, ...centerPortPoints]

      if (nodePortPoints.length > 0) {
        nodesWithPortPoints.push({
          capacityMeshNodeId: region.d.capacityMeshNodeId,
          center: region.d.center,
          width: region.d.width,
          height: region.d.height,
          portPoints: nodePortPoints,
          availableZ: region.d.availableZ,
        })
      }

      const inputPortPoints: InputPortPoint[] = region.ports.map((port) => {
        const portPointChain = port.d as typeof port.d & {
          prevPortPointId?: string
          nextPortPointId?: string
        }
        const connectsToOffBoardNode = port.d.regions.some((region) =>
          Boolean(region.d._offBoardConnectionId),
        )
        return {
          portPointId: port.d.portId,
          x: port.d.x,
          y: port.d.y,
          z: port.d.z,
          prevPortPointId: portPointChain.prevPortPointId,
          nextPortPointId: portPointChain.nextPortPointId,
          connectionNodeIds: port.d.regions.map(
            (region) => region.regionId,
          ) as [CapacityMeshNodeId, CapacityMeshNodeId],
          distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
          connectsToOffBoardNode,
        }
      })

      inputNodeWithPortPoints.push({
        capacityMeshNodeId: region.d.capacityMeshNodeId,
        center: region.d.center,
        width: region.d.width,
        height: region.d.height,
        portPoints: inputPortPoints,
        availableZ: region.d.availableZ,
        _containsObstacle: region.d._containsObstacle,
        _containsTarget: region.d._containsTarget,
        _offBoardConnectionId: region.d._offBoardConnectionId,
        _offBoardConnectedCapacityMeshNodeIds:
          region.d._offBoardConnectedCapacityMeshNodeIds,
      })
    }

    return {
      nodesWithPortPoints,
      inputNodeWithPortPoints,
    }
  }

  override visualize(): GraphicsObject {
    return mergeGraphicsArray([
      visualizeHgHyperGraph(this.params.graph),
      this.visualizePfOverlay(),
      visualizeHgConnections(
        this.params.connections,
        this.params.colorMap ?? {},
      ),
      this.solved
        ? null
        : visualizeCandidate(
            this.candidateQueue.peekMany(100) as CandidateHg[] | undefined,
            this.currentConnection?.startRegion.d.center,
          ),
      visualizeSolvedRoute(this.solvedRoutes, this.params.colorMap ?? {}),
    ])
  }

  private visualizePfOverlay(): GraphicsObject {
    const output = this.getOutput()
    const nodes = output?.inputNodeWithPortPoints ?? []
    const nodesWithPortPointsById = new Map(
      (output?.nodesWithPortPoints ?? []).map((node) => [
        node.capacityMeshNodeId,
        node,
      ]),
    )
    const graphics: GraphicsObject = { rects: [] }

    for (const node of nodes) {
      const pfValue = this.computeNodePf(node)
      const pf = pfValue ?? 0
      const solvedNode = nodesWithPortPointsById.get(node.capacityMeshNodeId)
      const crossings = solvedNode
        ? getIntraNodeCrossingsUsingCircle(solvedNode)
        : {
            numSameLayerCrossings: 0,
            numEntryExitLayerChanges: 0,
            numTransitionPairCrossings: 0,
          }
      const red = Math.min(255, Math.floor(pf * 512))
      const greenAndBlue = Math.max(0, 255 - Math.floor(pf * 512))
      let color = `rgba(${red}, ${greenAndBlue}, ${greenAndBlue}, ${pf < 0.001 ? "0.1" : "0.3"})`

      if (node._containsObstacle) {
        color = "rgba(255, 0, 0, 0.3)"
      }

      if (node._offBoardConnectedCapacityMeshNodeIds?.length) {
        color = "rgba(255, 165, 0, 0.3)"
      }

      graphics.rects!.push({
        center: node.center,
        width: node.width - 0.2,
        height: node.height - 0.2,
        layer: `z${node?.availableZ?.join(",")}`,
        fill: color,
        label: `${node.capacityMeshNodeId}\npf: ${pfValue === null ? "n/a" : pfValue.toFixed(3)}\nxSame: ${crossings.numSameLayerCrossings}, xLC: ${crossings.numEntryExitLayerChanges}, xTransition: ${crossings.numTransitionPairCrossings}`,
      })
    }

    return graphics
  }
}

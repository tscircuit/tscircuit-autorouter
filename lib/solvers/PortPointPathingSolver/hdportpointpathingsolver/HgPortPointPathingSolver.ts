import {
  type Candidate,
  HyperGraphSolver,
  type RegionPortAssignment,
  type SolvedRoute,
} from "@tscircuit/hypergraph"
import type { Connection, HyperGraph } from "@tscircuit/hypergraph"
import {
  distance,
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  HgPort,
  HgRegion,
} from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperGraphFromInputNodes"
import { buildPortPointAssignmentsFromSolvedRoutes } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildPortPointAssignmentsFromSolvedRoutes"
import { visualizeHgPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/visualizeHgPortPointPathingSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { computeSectionScore } from "lib/solvers/MultiSectionPortPointOptimizer"

const MAX_CANDIDATES_PER_REGION = 2

export interface HgPortPointPathingSolverParams {
  inputGraph: HyperGraph
  inputConnections: Connection[]
  connectionsWithResults: ConnectionPathResult[]
  inputNodes: InputNodeWithPortPoints[]
  portPointMap: Map<string, InputPortPoint>
  nodeMemoryPfMap: Map<CapacityMeshNodeId, number>
  rippingEnabled: boolean
  forceCenterFirst: boolean
  weights: {
    greedyMultiplier: number
    ripCost: number
    portUsagePenalty: number
    regionTransitionPenalty: number
    memoryPfFactor: number
    straightLineDeviationPenaltyFactor: number
    ripNodePfThresholdStart: number
    maxNodeRips: number
    randomRipFraction: number
    maxRips: number
  }
  MIN_ALLOWED_BOARD_SCORE: number
}

export class HgPortPointPathingSolver extends HyperGraphSolver<
  HgRegion,
  HgPort
> {
  inputNodes: InputNodeWithPortPoints[]
  nodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>
  regionMap: Map<CapacityMeshNodeId, HgRegion>
  portPointMap: Map<string, InputPortPoint>
  connectionsWithResults: ConnectionPathResult[] = []
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  > = new Map()
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]> = new Map()
  assignmentsBuilt = false

  portUsagePenalty: number
  regionTransitionPenalty: number
  ripNodePfThresholdStart: number
  maxNodeRips: number
  memoryPfFactor: number
  forceCenterFirst: boolean
  straightLineDeviationPenaltyFactor: number
  connectionResultByConnectionId: Map<string, ConnectionPathResult>
  nodeRipCountMap: Map<CapacityMeshNodeId, number> = new Map()
  nodeMemoryPfMap: Map<CapacityMeshNodeId, number> = new Map()
  totalRipCount = 0
  randomRipFraction: number
  maxRips: number
  MIN_ALLOWED_BOARD_SCORE: number

  constructor({
    inputGraph,
    inputConnections,
    connectionsWithResults,
    inputNodes,
    portPointMap,
    nodeMemoryPfMap,
    rippingEnabled,
    weights,
    forceCenterFirst,
    MIN_ALLOWED_BOARD_SCORE,
  }: HgPortPointPathingSolverParams) {
    const {
      greedyMultiplier,
      maxNodeRips,
      memoryPfFactor,
      portUsagePenalty,
      regionTransitionPenalty,
      straightLineDeviationPenaltyFactor,
      ripCost,
      ripNodePfThresholdStart,
      randomRipFraction,
      maxRips,
    } = weights
    super({
      inputGraph,
      inputConnections,
      greedyMultiplier: greedyMultiplier,
      rippingEnabled: rippingEnabled ?? true,
      ripCost: ripCost,
    })
    this.inputNodes = inputNodes
    this.nodeMap = new Map(
      inputNodes.map((node) => [node.capacityMeshNodeId, node]),
    )
    this.regionMap = new Map(
      this.graph.regions.map((region) => [
        region.regionId as CapacityMeshNodeId,
        region as HgRegion,
      ]),
    )
    this.portPointMap = portPointMap
    this.connectionsWithResults = connectionsWithResults

    this.portUsagePenalty = portUsagePenalty
    this.regionTransitionPenalty = regionTransitionPenalty
    this.ripNodePfThresholdStart = ripNodePfThresholdStart
    this.maxNodeRips = maxNodeRips
    this.memoryPfFactor = memoryPfFactor
    this.forceCenterFirst = forceCenterFirst
    this.straightLineDeviationPenaltyFactor = straightLineDeviationPenaltyFactor
    this.nodeMemoryPfMap = nodeMemoryPfMap
    this.randomRipFraction = randomRipFraction
    this.maxRips = maxRips
    this.MIN_ALLOWED_BOARD_SCORE = MIN_ALLOWED_BOARD_SCORE
    this.MAX_ITERATIONS = 200000
    this.connectionResultByConnectionId = new Map(
      connectionsWithResults.map((result) => [result.connection.name, result]),
    )
  }

  private clampPf(pf: number): number {
    if (!Number.isFinite(pf)) return 0
    return Math.max(0, Math.min(0.9999, pf))
  }

  private pfToFailureCost(pf: number): number {
    return -Math.log(1 - this.clampPf(pf))
  }

  private recordNodeMemoryPf(nodeId: CapacityMeshNodeId, pf: number): void {
    const clampedPf = this.clampPf(pf)
    const prevPf = this.nodeMemoryPfMap.get(nodeId) ?? 0
    const updatedPf = Math.max(clampedPf, prevPf * 0.98)
    this.nodeMemoryPfMap.set(nodeId, updatedPf)
  }

  override estimateCostToEnd(port: HgPort): number {
    const endCenter = this.currentEndRegion?.d?.center
    if (!endCenter) return 0
    return distance({ x: port.d.x, y: port.d.y }, endCenter)
  }

  override computeH(candidate: Candidate<HgRegion, HgPort>): number {
    const distanceToEnd = this.estimateCostToEnd(candidate.port)
    const centerBias = candidate.port.d.distToCentermostPortOnZ ?? 0
    const regionIdForMemory =
      candidate.nextRegion?.regionId ?? candidate.lastRegion?.regionId
    const memoryPf = regionIdForMemory
      ? (this.nodeMemoryPfMap.get(regionIdForMemory) ?? 0)
      : 0
    const memoryPfPenalty = this.pfToFailureCost(memoryPf) * this.memoryPfFactor
    const straightLineDeviationPenalty =
      this.getStraightLineDeviationPenalty(candidate)
    return (
      distanceToEnd +
      centerBias * 0.05 +
      memoryPfPenalty +
      straightLineDeviationPenalty
    )
  }

  private getStraightLineDeviationPenalty(
    candidate: Candidate<HgRegion, HgPort>,
  ): number {
    if (this.straightLineDeviationPenaltyFactor <= 0) return 0

    const connectionId = this.currentConnection?.connectionId
    if (!connectionId) return 0

    const connectionResult =
      this.connectionResultByConnectionId.get(connectionId)
    const pointsToConnect = connectionResult?.connection.pointsToConnect
    if (!pointsToConnect || pointsToConnect.length < 2) return 0

    const startPoint = pointsToConnect[0]
    const endPoint = pointsToConnect[1]
    const candidatePoint = { x: candidate.port.d.x, y: candidate.port.d.y }
    const deviation = pointToSegmentDistance(
      candidatePoint,
      startPoint,
      endPoint,
    )
    return this.straightLineDeviationPenaltyFactor * deviation
  }

  override computeIncreasedRegionCostIfPortsAreUsed(
    region: HgRegion,
    port1: HgPort,
    port2: HgPort,
  ): number {
    const transitionDistance = distance(
      { x: port1.d.x, y: port1.d.y },
      { x: port2.d.x, y: port2.d.y },
    )
    const regionSizePenalty = Math.max(region.d.width, region.d.height) * 0.01
    return transitionDistance * this.regionTransitionPenalty + regionSizePenalty
  }

  override getPortUsagePenalty(port: HgPort): number {
    const ripCount = port.ripCount ?? 0
    return ripCount * this.portUsagePenalty
  }

  override getRipsRequiredForPortUsage(
    region: HgRegion,
    port1: HgPort,
    port2: HgPort,
  ): RegionPortAssignment[] {
    const assignments = region.assignments ?? []
    if (assignments.length === 0) return []
    const newSegmentStart = { x: port1.d.x, y: port1.d.y }
    const newSegmentEnd = { x: port2.d.x, y: port2.d.y }

    const ripsRequired = assignments.filter((assignment) => {
      if (
        assignment.connection.mutuallyConnectedNetworkId ===
        this.currentConnection?.mutuallyConnectedNetworkId
      ) {
        return false
      }
      const existingPort1 = assignment.regionPort1 as HgPort
      const existingPort2 = assignment.regionPort2 as HgPort
      if (existingPort1 === port1 || existingPort1 === port2) return false
      if (existingPort2 === port1 || existingPort2 === port2) return false
      const existingStart = { x: existingPort1.d.x, y: existingPort1.d.y }
      const existingEnd = { x: existingPort2.d.x, y: existingPort2.d.y }
      return doSegmentsIntersect(
        newSegmentStart,
        newSegmentEnd,
        existingStart,
        existingEnd,
      )
    })

    return ripsRequired
  }

  private isPortAvailableForCurrentNet(port: HgPort): boolean {
    const assignment = port.assignment
    if (!assignment) return true

    const currentNetId = this.currentConnection?.mutuallyConnectedNetworkId
    return assignment.connection.mutuallyConnectedNetworkId === currentNetId
  }

  private getCenterFirstCandidatesForRegion(
    candidates: Candidate<HgRegion, HgPort>[],
  ): Candidate<HgRegion, HgPort>[] {
    const byZ = new Map<number, Candidate<HgRegion, HgPort>[]>()

    for (const candidate of candidates) {
      const z = candidate.port.d.z ?? 0
      const candidatesOnZ = byZ.get(z) ?? []
      candidatesOnZ.push(candidate)
      byZ.set(z, candidatesOnZ)
    }

    const selected: Candidate<HgRegion, HgPort>[] = []

    for (const candidatesOnZ of byZ.values()) {
      const sortedByCenterOffset = candidatesOnZ
        .slice()
        .sort(
          (a, b) =>
            a.port.d.distToCentermostPortOnZ - b.port.d.distToCentermostPortOnZ,
        )
      const centerCandidate = sortedByCenterOffset[0]
      if (!centerCandidate) continue

      if (this.isPortAvailableForCurrentNet(centerCandidate.port)) {
        selected.push(centerCandidate)
        continue
      }

      const sortedByPosition = candidatesOnZ.slice().sort((a, b) => {
        if (a.port.d.x !== b.port.d.x) return a.port.d.x - b.port.d.x
        return a.port.d.y - b.port.d.y
      })

      const availableRanges: Candidate<HgRegion, HgPort>[][] = []
      let currentRange: Candidate<HgRegion, HgPort>[] = []

      for (const candidate of sortedByPosition) {
        if (this.isPortAvailableForCurrentNet(candidate.port)) {
          currentRange.push(candidate)
          continue
        }

        if (currentRange.length > 0) {
          availableRanges.push(currentRange)
          currentRange = []
        }
      }

      if (currentRange.length > 0) {
        availableRanges.push(currentRange)
      }

      for (const range of availableRanges) {
        selected.push(range[Math.floor(range.length / 2)])
      }
    }

    return selected
  }

  override selectCandidatesForEnteringRegion(
    candidates: Candidate<HgRegion, HgPort>[],
  ): Candidate<HgRegion, HgPort>[] {
    const startRegion = this.currentConnection?.startRegion
    const endRegion = this.currentConnection?.endRegion

    const filteredCandidates = candidates.filter((candidate) => {
      const nextRegion = candidate.nextRegion
      if (!nextRegion?.d._containsObstacle) return true
      return nextRegion === startRegion || nextRegion === endRegion
    })

    const centerFirstCandidates = this.forceCenterFirst
      ? this.getCenterFirstCandidatesForRegion(filteredCandidates)
      : filteredCandidates

    if (centerFirstCandidates.length <= MAX_CANDIDATES_PER_REGION) {
      return centerFirstCandidates
    }

    return centerFirstCandidates
      .slice()
      .sort((a, b) => a.g + a.h - (b.g + b.h))
      .slice(0, MAX_CANDIDATES_PER_REGION)
  }

  override routeSolvedHook(solvedRoute: SolvedRoute): void {
    const traversedRegions = new Set<HgRegion>()
    for (const candidate of solvedRoute.path) {
      const region = candidate.lastRegion as HgRegion | undefined
      if (region) traversedRegions.add(region)
    }
    for (const region of traversedRegions) {
      const regionPf = this.computeNodePfFromAssignments(region)
      this.recordNodeMemoryPf(region.regionId as CapacityMeshNodeId, regionPf)
    }

    if (!solvedRoute.requiredRip) return
    if (this.unprocessedConnections.length < 2) return

    const [next, ...rest] = this.unprocessedConnections
    this.unprocessedConnections = [...rest, next]
  }

  override _step(): void {
    super._step()
    if (this.enforceBoardScoreGuardrail()) return
    this.buildAssignmentsIfSolved()
  }

  private enforceBoardScoreGuardrail(): boolean {
    if (!this.solved || this.failed) return false

    const boardScore = this.computeBoardScore()
    this.stats = {
      ...this.stats,
      boardScore,
      totalRipCount: this.totalRipCount,
    }

    if (boardScore >= this.MIN_ALLOWED_BOARD_SCORE) return false

    this.error = `Board score ${boardScore.toFixed(2)} is less than MIN_ALLOWED_BOARD_SCORE ${this.MIN_ALLOWED_BOARD_SCORE.toFixed(2)}`
    this.failed = true
    this.solved = false

    return true
  }

  private buildAssignmentsIfSolved(): void {
    if (!this.solved || this.assignmentsBuilt) {
      return
    }
    const assignments = buildPortPointAssignmentsFromSolvedRoutes({
      solvedRoutes: this.solvedRoutes,
      connectionResults: this.connectionsWithResults,
      inputNodes: this.inputNodes,
    })
    this.connectionsWithResults = assignments.connectionsWithResults
    this.assignedPortPoints = assignments.assignedPortPoints
    this.nodeAssignedPortPoints = assignments.nodeAssignedPortPoints
    this.assignmentsBuilt = true
  }

  private getNodeRippingPfThreshold(nodeId: CapacityMeshNodeId): number {
    const nodeRipCount = this.nodeRipCountMap.get(nodeId) ?? 0
    const nodeRipFraction = Math.min(1, nodeRipCount / this.maxNodeRips)
    const startRippingPfThreshold = this.ripNodePfThresholdStart
    const threshold =
      startRippingPfThreshold * (1 - nodeRipFraction) + 1 * nodeRipFraction

    return threshold
  }

  private getPortPointsFromRegionAssignments(
    assignments: RegionPortAssignment[],
  ): PortPoint[] {
    return assignments.flatMap((assignment) => {
      const regionPort1 = assignment.regionPort1 as HgPort
      const regionPort2 = assignment.regionPort2 as HgPort
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
      ]
    })
  }

  private getPortPointsFromNewlySolvedRouteInRegion(
    newlySolvedRoute: SolvedRoute,
    region: HgRegion,
  ): PortPoint[] {
    return newlySolvedRoute.path.flatMap((candidate) => {
      if (!candidate.lastPort || candidate.lastRegion !== region) {
        return []
      }

      const lastPort = candidate.lastPort as HgPort
      const currentPort = candidate.port as HgPort

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
      ]
    })
  }

  private computeNodePfForRegion({
    region,
    newlySolvedRoute,
    routesToRip,
  }: {
    region: HgRegion
    newlySolvedRoute: SolvedRoute
    routesToRip: Set<SolvedRoute>
  }): number {
    const node = this.nodeMap.get(region.regionId)
    if (!node || node._containsTarget) {
      return 0
    }

    const existingAssignments = (region.assignments ?? []).filter(
      (assignment) => !routesToRip.has(assignment.solvedRoute),
    )
    const existingPortPoints =
      this.getPortPointsFromRegionAssignments(existingAssignments)
    const newlySolvedRoutePortPoints =
      this.getPortPointsFromNewlySolvedRouteInRegion(newlySolvedRoute, region)
    const portPoints = [...existingPortPoints, ...newlySolvedRoutePortPoints]

    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints,
      availableZ: node.availableZ,
    }
    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
    const capacityMeshNode = this.getDerivedCapacityMeshNode(node)

    const pf = calculateNodeProbabilityOfFailure(
      capacityMeshNode,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )

    return pf
  }

  private computeNodePfFromAssignments(region: HgRegion): number {
    const node = this.nodeMap.get(region.regionId)
    if (!node || node._containsTarget) {
      return 0
    }

    const existingAssignments = region.assignments ?? []
    const existingPortPoints =
      this.getPortPointsFromRegionAssignments(existingAssignments)

    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints: existingPortPoints,
      availableZ: node.availableZ,
    }
    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
    const capacityMeshNode = this.getDerivedCapacityMeshNode(node)

    return calculateNodeProbabilityOfFailure(
      capacityMeshNode,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  private getDerivedCapacityMeshNode(
    node: InputNodeWithPortPoints,
  ): CapacityMeshNode {
    return {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      availableZ: node.availableZ,
      layer: `z${node.availableZ.join(",")}`,
      _containsObstacle: node._containsObstacle,
      _containsTarget: node._containsTarget,
      _offBoardConnectionId: node._offBoardConnectionId,
      _offBoardConnectedCapacityMeshNodeIds:
        node._offBoardConnectedCapacityMeshNodeIds,
    }
  }

  private getCrossingRoutesByNodeForPath(
    newlySolvedRoute: SolvedRoute,
  ): Map<CapacityMeshNodeId, Set<SolvedRoute>> {
    const crossingRoutesByNode = new Map<CapacityMeshNodeId, Set<SolvedRoute>>()

    for (const candidate of newlySolvedRoute.path) {
      if (!candidate.lastPort || !candidate.lastRegion) continue
      const region = candidate.lastRegion as HgRegion
      const nodeId = region.regionId as CapacityMeshNodeId

      const crossingAssignments = this.getRipsRequiredForPortUsage(
        region,
        candidate.lastPort as HgPort,
        candidate.port as HgPort,
      )
      if (crossingAssignments.length === 0) continue

      const crossingRoutesInNode = crossingRoutesByNode.get(nodeId) ?? new Set()
      for (const assignment of crossingAssignments) {
        crossingRoutesInNode.add(assignment.solvedRoute)
      }
      crossingRoutesByNode.set(nodeId, crossingRoutesInNode)
    }

    return crossingRoutesByNode
  }

  private getCandidateRoutesForNodeRipping({
    nodeId,
    routesToRip,
    newlySolvedRoute,
  }: {
    nodeId: CapacityMeshNodeId
    routesToRip: Set<SolvedRoute>
    newlySolvedRoute: SolvedRoute
  }): SolvedRoute[] {
    const region = this.regionMap.get(nodeId)
    if (!region?.assignments?.length) return []

    const routeMap = new Map<string, SolvedRoute>()
    for (const assignment of region.assignments) {
      const route = assignment.solvedRoute
      const routeConnectionId = route.connection.connectionId
      if (routeConnectionId === newlySolvedRoute.connection.connectionId) {
        continue
      }
      if (routesToRip.has(route)) continue
      routeMap.set(routeConnectionId, route)
    }

    return [...routeMap.values()]
  }

  private getNodeIdsTraversedByRoute(
    route: SolvedRoute,
  ): Array<CapacityMeshNodeId> {
    const nodeIdSet = new Set<CapacityMeshNodeId>()
    for (const candidate of route.path) {
      const region = candidate.lastRegion as HgRegion | undefined
      if (!region) continue
      nodeIdSet.add(region.regionId as CapacityMeshNodeId)
    }
    return [...nodeIdSet]
  }

  private maybeAddRandomRips({
    routesToRip,
    newlySolvedRoute,
    randomSeed,
  }: {
    routesToRip: Set<SolvedRoute>
    newlySolvedRoute: SolvedRoute
    randomSeed: number
  }): void {
    if (this.randomRipFraction <= 0) return
    if (this.totalRipCount >= this.maxRips) return

    const eligibleRoutes = this.solvedRoutes.filter((route) => {
      if (routesToRip.has(route)) return false
      return (
        route.connection.connectionId !==
        newlySolvedRoute.connection.connectionId
      )
    })

    if (eligibleRoutes.length === 0) return

    const randomRipCount = Math.max(
      1,
      Math.floor(this.randomRipFraction * eligibleRoutes.length),
    )
    const shuffledEligibleRoutes = cloneAndShuffleArray(
      eligibleRoutes,
      randomSeed,
    )

    let addedRandomRips = 0
    for (const route of shuffledEligibleRoutes) {
      if (addedRandomRips >= randomRipCount) break
      if (this.totalRipCount >= this.maxRips) break
      if (routesToRip.has(route)) continue

      routesToRip.add(route)
      addedRandomRips++
      this.totalRipCount++
    }
  }

  override computeRoutesToRip(newlySolvedRoute: SolvedRoute): Set<SolvedRoute> {
    const portOverlapRoutesToRip = super.computePortOverlapRoutes(
      newlySolvedRoute,
    )
    const routesToRip = new Set<SolvedRoute>(portOverlapRoutesToRip)

    const crossingRoutesByNode =
      this.getCrossingRoutesByNodeForPath(newlySolvedRoute)
    const rippingRandomSeed =
      this.iterations + this.solvedRoutes.length + this.totalRipCount

    const traversedNodeIds = this.getNodeIdsTraversedByRoute(newlySolvedRoute)
    const allNodeIdsForRipping = Array.from(
      new Set([...traversedNodeIds, ...crossingRoutesByNode.keys()]),
    )
    const orderedNodeIds = cloneAndShuffleArray(
      allNodeIdsForRipping,
      rippingRandomSeed,
    )

    for (const nodeId of orderedNodeIds) {
      if (this.totalRipCount >= this.maxRips) {
        break
      }

      const region = this.regionMap.get(nodeId)
      if (!region) continue

      const rippingPfThreshold = this.getNodeRippingPfThreshold(nodeId)
      let currentPf = this.computeNodePfForRegion({
        region,
        newlySolvedRoute,
        routesToRip,
      })
      this.recordNodeMemoryPf(nodeId, currentPf)

      if (currentPf <= rippingPfThreshold) continue

      const testedConnectionIds = new Set<string>()
      let ripCountForNodeLoop = 0

      while (currentPf > rippingPfThreshold) {
        if (this.totalRipCount >= this.maxRips) break

        const availableRoutesInNode = this.getCandidateRoutesForNodeRipping({
          nodeId,
          routesToRip,
          newlySolvedRoute,
        }).filter(
          (route) =>
            !testedConnectionIds.has(route.connection.connectionId) &&
            !routesToRip.has(route),
        )

        if (availableRoutesInNode.length === 0) break

        const shuffledRoutesInNode = cloneAndShuffleArray(
          availableRoutesInNode,
          rippingRandomSeed + ripCountForNodeLoop + testedConnectionIds.size,
        )
        const routeToRip = shuffledRoutesInNode[0]
        if (!routeToRip) break
        testedConnectionIds.add(routeToRip.connection.connectionId)

        routesToRip.add(routeToRip)
        this.totalRipCount++
        ripCountForNodeLoop++
        this.nodeRipCountMap.set(
          nodeId,
          (this.nodeRipCountMap.get(nodeId) ?? 0) + 1,
        )

        currentPf = this.computeNodePfForRegion({
          region,
          newlySolvedRoute,
          routesToRip,
        })
        this.recordNodeMemoryPf(nodeId, currentPf)
      }
    }

    const didRipAnyInLoop = routesToRip.size > portOverlapRoutesToRip.size
    if (didRipAnyInLoop) {
      this.maybeAddRandomRips({
        routesToRip,
        newlySolvedRoute,
        randomSeed: rippingRandomSeed + 10_000,
      })
    }

    return routesToRip
  }

  getNodesWithPortPoints(): NodeWithPortPoints[] {
    const nodesWithPortPoints: NodeWithPortPoints[] = []
    for (const node of this.inputNodes) {
      const assignedPortPoints =
        this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []
      if (assignedPortPoints.length === 0) {
        continue
      }
      nodesWithPortPoints.push({
        capacityMeshNodeId: node.capacityMeshNodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPoints: assignedPortPoints,
        availableZ: node.availableZ,
      })
    }
    return nodesWithPortPoints
  }

  computeBoardScore(): number {
    let nodeAssignedPortPoints = this.nodeAssignedPortPoints
    if (!this.assignmentsBuilt) {
      const assignments = buildPortPointAssignmentsFromSolvedRoutes({
        solvedRoutes: this.solvedRoutes,
        connectionResults: this.connectionsWithResults,
        inputNodes: this.inputNodes,
      })
      nodeAssignedPortPoints = assignments.nodeAssignedPortPoints
    }

    const nodesWithPortPoints: NodeWithPortPoints[] = []
    for (const node of this.inputNodes) {
      const assignedPortPoints =
        nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []
      if (assignedPortPoints.length === 0) continue
      nodesWithPortPoints.push({
        capacityMeshNodeId: node.capacityMeshNodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPoints: assignedPortPoints,
        availableZ: node.availableZ,
      })
    }

    const capacityMeshNodeMap = new Map(
      this.inputNodes.map((node) => [
        node.capacityMeshNodeId,
        this.getDerivedCapacityMeshNode(node),
      ]),
    )
    return computeSectionScore(nodesWithPortPoints, capacityMeshNodeMap)
  }

  computeNodePf(node: InputNodeWithPortPoints): number {
    const portPoints = this.nodeAssignedPortPoints.get(node.capacityMeshNodeId)
    if (!portPoints || portPoints.length === 0) return 0

    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints,
      availableZ: node.availableZ,
    }
    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
    const capacityMeshNode = this.getDerivedCapacityMeshNode(node)

    const pf = calculateNodeProbabilityOfFailure(
      capacityMeshNode,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )

    return pf
  }

  visualize(): GraphicsObject {
    return visualizeHgPortPointPathingSolver(this)
  }
}

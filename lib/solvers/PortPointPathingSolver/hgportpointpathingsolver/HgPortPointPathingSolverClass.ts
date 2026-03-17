import { HyperGraphSolver, RegionPortAssignment } from "@tscircuit/hypergraph"
import {
  distance,
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { NodeWithPortPoints, PortPoint } from "@tscircuit/high-density-a01"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { GraphicsObject } from "graphics-debug"
import { assertDefined } from "./assertDefined"
import { mergeGraphicsArray } from "./mergeGraphicsArray"
import type {
  HgPortPointPathingSolverParams,
  RegionId,
  RegionMemoryPfMap,
  RegionRipCountMap,
  CandidateHg,
  ConnectionHg,
  RegionHg,
  RegionPortHg,
  SolvedRoutesHg,
} from "./types"
import { visualizeCandidate } from "./visualize/visualizeCandidate"
import { visualizeSolvedRoute } from "./visualize/visualizeSolvedRoute"
import { visualizeHgConnections } from "./visualize/visualizeHgConnections"
import { visualizeHgHyperGraph } from "./visualize/visualizeHgHyperGraph"

/** Solves port-point routing over an HG hypergraph using heuristics and optional ripping. */
export class HgPortPointPathingSolver extends HyperGraphSolver<
  RegionHg,
  RegionPortHg
> {
  private regionMemoryPfMap: RegionMemoryPfMap
  private baseRegionFailureCostMap: Map<RegionId, number>
  private regionRipCountMap: RegionRipCountMap
  private totalRipCount: number
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
    if (params.weights.MAX_ITERATIONS_PER_PATH > 0) {
      this.MAX_ITERATIONS =
        params.weights.MAX_ITERATIONS_PER_PATH * params.effort
    }
  }

  override estimateCostToEnd(port: RegionPortHg): number {
    const endRegion = this.currentEndRegion
    assertDefined(endRegion, "Current end region is undefined")
    return distance(port.d, endRegion.d.center)
  }

  override computeH(candidate: CandidateHg): number {
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

  override computeIncreasedRegionCostIfPortsAreUsed(
    region: RegionHg,
    port1: RegionPortHg,
    port2: RegionPortHg,
  ): number {
    const currentConnection = this.currentConnection
    assertDefined(currentConnection, "Current connection is undefined")

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
    let baseCost = super.computeG(candidate)
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

  override getPortUsagePenalty(port: RegionPortHg): number {
    const assignment = port.assignment
    if (!assignment) return 0

    const currentNetId = this.currentConnection?.mutuallyConnectedNetworkId
    if (assignment.connection.mutuallyConnectedNetworkId === currentNetId) {
      return 0
    }

    // Discourage reusing a port that is already occupied by a different net.
    return (
      Math.max(1, this.params.weights.NODE_PF_FACTOR) * 0.5 +
      this.params.weights.BASE_CANDIDATE_COST
    )
  }

  override getRipsRequiredForPortUsage(
    region: RegionHg,
    port1: RegionPortHg,
    port2: RegionPortHg,
  ): RegionPortAssignment[] {
    const assignment: RegionPortAssignment[] = region.assignments ?? []
    if (assignment.length === 0) return []

    const ripsRequired: RegionPortAssignment[] = assignment.filter(
      (assignment) => {
        if (
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

        return doSegmentsIntersect(
          assignment.regionPort1.d,
          assignment.regionPort2.d,
          port1.d,
          port2.d,
        )
      },
    )

    return ripsRequired
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
    const routesToRip = new Set<SolvedRoutesHg>(portOverlapRoutesToRip)

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
    const didRipAnyLoop = routesToRip.size > portOverlapRoutesToRip.size
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

  private getRegionAssignedPortPoints(region: RegionHg): PortPoint[] {
    const existingAssignments = region.assignments ?? []
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
  ): number {
    const existingPortPoints = this.getRegionAssignedPortPoints(region)
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

        return [
          {
            portPointId: assignment.regionPort1.d.portId,
            x: assignment.regionPort1.d.x,
            y: assignment.regionPort1.d.y,
            z: assignment.regionPort1.d.z,
            connectionName,
            rootConnectionName,
          },
          {
            portPointId: assignment.regionPort2.d.portId,
            x: assignment.regionPort2.d.x,
            y: assignment.regionPort2.d.y,
            z: assignment.regionPort2.d.z,
            connectionName,
            rootConnectionName,
          },
        ] as PortPoint[]
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
          centerPortPoints.push({
            portPointId: `center:${region.regionId}:${connectionName}:${rootConnectionName}`,
            x: region.d.center.x,
            y: region.d.center.y,
            z: firstPoint.z,
            connectionName,
            rootConnectionName: rootConnectionName || undefined,
          })
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
        const connectsToOffBoardNode = port.d.regions.some((region) =>
          Boolean(region.d._offBoardConnectionId),
        )
        return {
          portPointId: port.d.portId,
          x: port.d.x,
          y: port.d.y,
          z: port.d.z,
          connectionNodeIds: port.d.regions.map((region) => region.regionId),
          distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
          connectsToOffBoardNode,
        } as InputPortPoint
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
      visualizeHgConnections(
        this.params.connections,
        this.params.colorMap ?? {},
      ),
      visualizeCandidate(
        this.candidateQueue.peekMany(100) as CandidateHg[] | undefined,
        this.currentConnection?.startRegion.d.center,
      ),
      visualizeSolvedRoute(this.solvedRoutes, this.params.colorMap ?? {}),
    ])
  }
}

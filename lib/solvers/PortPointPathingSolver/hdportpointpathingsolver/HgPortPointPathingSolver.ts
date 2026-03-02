import {
  Candidate,
  Connection,
  HyperGraph,
  HyperGraphSolver,
  Region,
  RegionPort,
  RegionPortAssignment,
  SolvedRoute,
} from "@tscircuit/hypergraph"
import { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import {
  CapacityMeshNode,
  CapacityMeshNodeId,
  ConnectionPoint,
  SimpleRouteConnection,
} from "lib/types"
import {
  distance,
  doSegmentsIntersect,
  pointToBoxDistance,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { GraphicsObject, Line, mergeGraphics, Point } from "graphics-debug"
import { NodeWithPortPoints, PortPoint } from "@tscircuit/high-density-a01"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

type TypedRegionPortAssignment = Omit<
  RegionPortAssignment,
  "regionPort1" | "regionPort2" | "region" | "connection" | "solvedRoute"
> & {
  regionPort1: TypedRegionPort
  regionPort2: TypedRegionPort
  region: TypedRegion
  connection: TypedConnection
  solvedRoute: TypedSolvedRoutes
}

type TypedRegion = Omit<Region, "d" | "assignments" | "ports"> & {
  d: CapacityMeshNode
  assignments?: TypedRegionPortAssignment[]
  ports: TypedRegionPort[]
}

type TypedRegionPort = Omit<RegionPort, "d" | "port"> & {
  d: SegmentPortPoint
}

type TypedHyperGraph = Omit<HyperGraph, "ports" | "regions"> & {
  ports: TypedRegionPort[]
  regions: TypedRegion[]
}

type TypedConnection = Omit<Connection, "startRegion" | "endRegion"> & {
  startRegion: TypedRegion
  endRegion: TypedRegion
  simpleRouteConnection?: SimpleRouteConnection
}

type TypedCandidate = Omit<
  Candidate,
  "port" | "parent" | "lastPort" | "lastRegion" | "nextRegion"
> & {
  port: TypedRegionPort
  parent?: TypedCandidate
  lastPort?: TypedRegionPort
  lastRegion?: TypedRegion
  nextRegion?: TypedRegion
  ripRequired: boolean
}

type TypedSolvedRoutes = Omit<SolvedRoute, "path" | "connection"> & {
  path: TypedCandidate[]
  connection: TypedConnection
}

type RegionId = CapacityMeshNodeId
type RegionMemoryPfMap = Map<RegionId, number>
type RegionRipCountMap = Map<RegionId, number>

/**
 * I prefer this over throw
 */
function assertDefined<T>(
  value: T | undefined | null,
  message: string,
): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message)
  }
}

const sharedZLayers = (layer1: number[], layer2: number[]): number[] => {
  const shared = []
  for (const z1 of layer1) {
    if (layer2.includes(z1)) {
      shared.push(z1)
    }
  }
  return shared
}

const checkIfConnectionPointIsInRegion = (params: {
  point: ConnectionPoint
  region: TypedRegion
  layerCount: number
}): boolean => {
  if (pointToBoxDistance(params.point, params.region.d) === 0) {
    let layers =
      "layers" in params.point ? params.point.layers : [params.point.layer]
    let intLayers = layers.map((layer) => {
      return mapLayerNameToZ(layer, params.layerCount)
    })
    const sharedLayers = sharedZLayers(intLayers, params.region.d.availableZ)
    if (sharedLayers.length > 0) {
      return true
    }
  }
  return false
}

/**
 * We build a hypergraph from the input nodes and simple route json
 * we expect the simple route json connection to be in pairs
 * the pointsToConnection should be in pairs
 */
export const buildGraph = (params: {
  simpleRouteJsonConnections: SimpleRouteConnection[]
  capacityMeshNodes: CapacityMeshNode[]
  segmentPortPoints: SegmentPortPoint[]
  layerCount: number
}): { graph: TypedHyperGraph; connections: TypedConnection[] } => {
  const graph: TypedHyperGraph = {
    ports: [],
    regions: [],
  }
  const connections: TypedConnection[] = []

  for (const cmnNode of params.capacityMeshNodes) {
    graph.regions.push({
      regionId: cmnNode.capacityMeshNodeId,
      d: cmnNode,
      ports: [],
    })
  }

  for (const spp of params.segmentPortPoints) {
    const [region1Id, region2Id] = spp.nodeIds
    const region1 = graph.regions.find(
      (region) => region.regionId === region1Id,
    )
    const region2 = graph.regions.find(
      (region) => region.regionId === region2Id,
    )

    assertDefined(
      region1,
      `Could not find region with id ${region1Id} for segment port point ${spp.segmentPortPointId}`,
    )
    assertDefined(
      region2,
      `Could not find region with id ${region2Id} for segment port point ${spp.segmentPortPointId}`,
    )

    const typedPort: TypedRegionPort = {
      portId: spp.segmentPortPointId,
      d: spp,
      region1: region1,
      region2: region2,
    }
    graph.ports.push(typedPort)
    region1.ports.push(typedPort)
    region2.ports.push(typedPort)
  }

  for (const connection of params.simpleRouteJsonConnections) {
    const pointsToConnectPars = connection.pointsToConnect
    const [startPoint, endPoint] = pointsToConnectPars
    const startRegion = graph.regions.find((region) =>
      checkIfConnectionPointIsInRegion({
        point: startPoint,
        region: region,
        layerCount: params.layerCount,
      }),
    )
    const endRegion = graph.regions.find((region) =>
      checkIfConnectionPointIsInRegion({
        point: endPoint,
        region: region,
        layerCount: params.layerCount,
      }),
    )

    assertDefined(
      startRegion,
      `Could not find start region for connection "${connection.name}"`,
    )
    assertDefined(
      endRegion,
      `Could not find end region for connection "${connection.name}"`,
    )

    connections.push({
      connectionId: connection.name,
      mutuallyConnectedNetworkId:
        connection.rootConnectionName ?? connection.name,
      startRegion: startRegion,
      endRegion: endRegion,
      simpleRouteConnection: connection,
    })
  }

  return { graph, connections }
}

export interface HgPortPointPathingSolverParams {
  graph: TypedHyperGraph
  connections: TypedConnection[]
  layerCount: number
  effort: number
  flags: {
    rippingEnabled: boolean
    forceCenterFirstEnabled: boolean
  }
  weights: {
    GREEDY_MULTIPLIER: number
    RIP_COST: number
    PORT_USAGE_PENALTY: number
    REGION_TRANSITION_PENALTY: number
    MEMORY_PF_FACTOR: number
    CENTER_OFFSET_DIST_PENALTY_FACTOR: number
    STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: number
    RIP_REGION_PF_THRESHOLD_START: number
    MAX_REGION_RIPS: number
    RANDOM_RIP_FRACTION: number
    MAX_RIPS: number
    MIN_ALLOWED_BOARD_SCORE: number
    MAX_CANDIDATES_PER_REGION: number
  }
  opts?: {
    regionMemoryPfMap?: RegionMemoryPfMap
  }
}

export class HgPortPointPathingSolver extends HyperGraphSolver<
  TypedRegion,
  TypedRegionPort
> {
  private regionMemoryPfMap: RegionMemoryPfMap
  private regionRipCountMap: RegionRipCountMap
  private totalRipCount: number
  constructor(private params: HgPortPointPathingSolverParams) {
    super({
      inputConnections: params.connections,
      inputGraph: params.graph,
      greedyMultiplier: params.weights.GREEDY_MULTIPLIER,
      ripCost: params.weights.RIP_COST,
      rippingEnabled: params.flags.rippingEnabled,
    })
    this.regionMemoryPfMap = params.opts?.regionMemoryPfMap ?? new Map()
    this.regionRipCountMap = new Map()
    this.totalRipCount = 0
    this.MAX_ITERATIONS *= params.effort
  }

  override estimateCostToEnd(port: TypedRegionPort): number {
    const endRegion = this.currentEndRegion
    assertDefined(endRegion, "Current end region is undefined")
    return distance(port.d, endRegion.d.center)
  }

  override computeH(
    candidate: Candidate<TypedRegion, TypedRegionPort>,
  ): number {
    const distanceToEnd = this.estimateCostToEnd(candidate.port)
    const centerOffsetPenalty =
      candidate.port.d.distToCentermostPortOnZ *
      this.params.weights.CENTER_OFFSET_DIST_PENALTY_FACTOR
    const regionIdForMemoryPf =
      candidate.nextRegion?.regionId ?? candidate.lastRegion?.regionId
    const memoryPf = regionIdForMemoryPf
      ? (this.regionMemoryPfMap.get(regionIdForMemoryPf) ?? 0)
      : 0
    const memoryPfPenalty = memoryPf * this.params.weights.MEMORY_PF_FACTOR
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
    region: TypedRegion,
    port1: TypedRegionPort,
    port2: TypedRegionPort,
  ): number {
    // TODO: I think we can do more
    const transitionDistance = distance(port1.d, port2.d)
    const regionSizePenalty = Math.max(region.d.width, region.d.height) * 0.01
    return (
      transitionDistance * this.params.weights.REGION_TRANSITION_PENALTY +
      regionSizePenalty
    )
  }

  override getPortUsagePenalty(port: TypedRegionPort): number {
    const ripCount = port.ripCount ?? 0
    return ripCount * this.params.weights.PORT_USAGE_PENALTY
  }

  override getRipsRequiredForPortUsage(
    region: TypedRegion,
    port1: TypedRegionPort,
    port2: TypedRegionPort,
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
    candidates: TypedCandidate[],
  ): TypedCandidate[] {
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

    const centerFirstCandidates = this.params.flags.forceCenterFirstEnabled
      ? this.getCenterFirstEnteringRegionCandidates(filterCandidates)
      : filterCandidates

    if (
      centerFirstCandidates.length <=
      this.params.weights.MAX_CANDIDATES_PER_REGION
    ) {
      return centerFirstCandidates
    }

    return centerFirstCandidates
      .sort((a, b) => a.g + a.h - (b.g + b.h))
      .slice(0, this.params.weights.MAX_CANDIDATES_PER_REGION)
  }

  override routeSolvedHook(solvedRoute: TypedSolvedRoutes): void {
    const traversedRegions = new Set<TypedRegion>()
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
    newlySolvedRoute: TypedSolvedRoutes,
  ): Set<TypedSolvedRoutes> {
    const portOverlapRoutesToRip = super.computePortOverlapRoutes(
      newlySolvedRoute,
    )
    const routesToRip = new Set<TypedSolvedRoutes>(portOverlapRoutesToRip)

    const crossingRoutesByRegion: Map<
      TypedRegion,
      Set<TypedSolvedRoutes>
    > = new Map()
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
      new Set<TypedRegion>([
        ...crossingRoutesByRegion.keys(),
        ...traversedRegions,
      ]),
    )
    const rippingRandomSeed =
      this.iterations + this.solvedRoutes.length + this.totalRipCount
    const ordereRegionIdsForRipping = cloneAndShuffleArray(
      allRegionIdsForRipping,
      rippingRandomSeed,
    )
    for (const region of ordereRegionIdsForRipping) {
      if (this.totalRipCount >= this.params.weights.MAX_RIPS) break
      const rippingThreshold = this.getRegionRippingPfThreshold(region.regionId)
      let currentPf = this.computeRegionPf({
        region,
        newlySolvedRoute,
        routesToRip,
      })
      this.regionMemoryPfMap.set(region.regionId, currentPf)

      if (currentPf <= rippingThreshold) continue

      const testedConnection = new Set<TypedConnection>()
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

  private computeDeviation(candidate: Candidate<TypedRegion, TypedRegionPort>) {
    const startPoint = this.currentConnection?.startRegion.d.center
    const endPoint = this.currentConnection?.endRegion.d.center
    assertDefined(startPoint, "Current connection or start region is undefined")
    assertDefined(endPoint, "Current connection or end region is undefined")
    const portPoint = candidate.port.d
    const deviation = pointToSegmentDistance(portPoint, startPoint, endPoint)
    return deviation
  }

  private getCenterFirstEnteringRegionCandidates(
    candidates: Candidate<TypedRegion, TypedRegionPort>[],
  ): Candidate<TypedRegion, TypedRegionPort>[] {
    const byZ = new Map<number, Candidate<TypedRegion, TypedRegionPort>[]>()
    for (const candidate of candidates) {
      const availableZ = candidate.port.d.availableZ
      for (const z of availableZ) {
        const candidatesOnZ = byZ.get(z) ?? []
        candidatesOnZ.push(candidate)
        byZ.set(z, candidatesOnZ)
      }
    }

    const selected: Candidate<TypedRegion, TypedRegionPort>[] = []

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

      const availableRangesCandidate: Candidate<
        TypedRegion,
        TypedRegionPort
      >[][] = []
      let currentRangeCandidate: Candidate<TypedRegion, TypedRegionPort>[] = []

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

  private isPortAvailableForCurrentNet(port: TypedRegionPort): boolean {
    const assignment = port.assignment
    if (!assignment) return true

    const currentNetId = this.currentConnection?.mutuallyConnectedNetworkId
    return assignment.connection.mutuallyConnectedNetworkId === currentNetId
  }

  private computeRegionPfFromAssignments(region: TypedRegion): number {
    const existingAssignments = region.assignments ?? []
    const existingPortPoints = existingAssignments.flatMap((assignment) => {
      const region1PortPoint = assignment.regionPort1.d
      const region2PortPoint = assignment.regionPort2.d
      const connectionName = assignment.connection.connectionId
      const rootConnectionName =
        assignment.connection.mutuallyConnectedNetworkId
      return [
        {
          x: region1PortPoint.x,
          y: region1PortPoint.y,
          z: region1PortPoint.availableZ[0] ?? 0,
          connectionName,
          rootConnectionName,
        },
        {
          x: region2PortPoint.x,
          y: region2PortPoint.y,
          z: region2PortPoint.availableZ[0] ?? 0,
          connectionName,
          rootConnectionName,
        },
      ] as PortPoint[]
    })

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

  private getRegionRippingPfThreshold(regionId: RegionId): number {
    const regionRipCount = this.regionRipCountMap.get(regionId) ?? 0
    const regionRipFraction = Math.min(
      1,
      regionRipCount / this.params.weights.MAX_REGION_RIPS,
    )
    const startRippingPfThreshold =
      this.params.weights.RIP_REGION_PF_THRESHOLD_START
    const threshold =
      startRippingPfThreshold * (1 - regionRipFraction) + 1 * regionRipFraction
    return threshold
  }

  private computeRegionPf({
    region,
    newlySolvedRoute,
    routesToRip,
  }: {
    region: TypedRegion
    newlySolvedRoute: TypedSolvedRoutes
    routesToRip: Set<TypedSolvedRoutes>
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
          z: regionPort1.d.availableZ[0] ?? 0,
          connectionName,
          rootConnectionName,
        },
        {
          x: regionPort2.d.x,
          y: regionPort2.d.y,
          z: regionPort2.d.availableZ[0] ?? 0,
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
            z: lastPort.d.availableZ[0],
            connectionName: newlySolvedRoute.connection.connectionId,
            rootConnectionName:
              newlySolvedRoute.connection.mutuallyConnectedNetworkId,
          },
          {
            x: currentPort.d.x,
            y: currentPort.d.y,
            z: currentPort.d.availableZ[0],
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

  getOutput(): {
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
      const path = route.path
      if (path.length === 0) continue
      const firstPort = path[0]?.port
      const lastPort = path[path.length - 1]?.port
      if (!firstPort || !lastPort) continue

      const connectionName = route.connection.connectionId
      const rootConnectionName = route.connection.mutuallyConnectedNetworkId

      const startRegionId = route.connection.startRegion.regionId as RegionId
      const endRegionId = route.connection.endRegion.regionId as RegionId

      const startPortPoints =
        endpointPortPointsByRegion.get(startRegionId) ?? []
      startPortPoints.push({
        portPointId: firstPort.d.segmentPortPointId,
        x: firstPort.d.x,
        y: firstPort.d.y,
        z: firstPort.d.availableZ[0] ?? 0,
        connectionName,
        rootConnectionName,
      })
      endpointPortPointsByRegion.set(startRegionId, startPortPoints)

      const endPortPoints = endpointPortPointsByRegion.get(endRegionId) ?? []
      endPortPoints.push({
        portPointId: lastPort.d.segmentPortPointId,
        x: lastPort.d.x,
        y: lastPort.d.y,
        z: lastPort.d.availableZ[0] ?? 0,
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
            portPointId: assignment.regionPort1.d.segmentPortPointId,
            x: assignment.regionPort1.d.x,
            y: assignment.regionPort1.d.y,
            z: assignment.regionPort1.d.availableZ[0] ?? 0,
            connectionName,
            rootConnectionName,
          },
          {
            portPointId: assignment.regionPort2.d.segmentPortPointId,
            x: assignment.regionPort2.d.x,
            y: assignment.regionPort2.d.y,
            z: assignment.regionPort2.d.availableZ[0] ?? 0,
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
        const connectsToOffBoardNode = port.d.nodeIds.some(
          (nodeId: CapacityMeshNodeId) =>
            Boolean(regionById.get(nodeId)?.d._offBoardConnectionId),
        )
        return {
          portPointId: port.d.segmentPortPointId,
          x: port.d.x,
          y: port.d.y,
          z: port.d.availableZ[0] ?? 0,
          connectionNodeIds: port.d.nodeIds,
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
      visualizeTypedHyperGraph(this.params.graph),
      visualizeTypedConnections(this.params.connections),
      visualizeCandidate(
        this.candidateQueue.peekMany(10) as TypedCandidate[] | undefined,
        this.currentConnection?.startRegion.d.center,
      ),
    ])
  }
}

const mergeGraphicsArray = (
  graphicsObjects: (GraphicsObject | null | undefined)[],
): GraphicsObject => {
  let merged: GraphicsObject | undefined | null = {}
  merged = graphicsObjects.reduce((acc, obj) => {
    if (!acc || !obj) {
      return {}
    }
    return mergeGraphics(acc, obj)
  }, merged)
  if (!merged) {
    return {}
  }
  return merged
}

const visualizeCandidate = (
  candidates: TypedCandidate[] | undefined,
  startPoint: Point,
): GraphicsObject | null => {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
  }

  if (!candidates) {
    return graphics
  }

  let currentCandidate = candidates.shift()
  if (!currentCandidate) {
    return graphics
  }

  const currentCandidatePath: Line = {
    points: [],
    strokeColor: "rgba(255, 250, 50, 1)",
    strokeWidth: 0.1,
  }
  graphics.points!.push({
    ...currentCandidate.port.d,
    color: "rgb(255, 50, 50)",
    label: `g: ${currentCandidate.g}\nh: ${currentCandidate.h}\nf: ${currentCandidate.f}\nripRequired: ${currentCandidate.ripRequired}`,
  })

  do {
    currentCandidatePath.points.push(currentCandidate.port.d)
    currentCandidate = currentCandidate.parent
  } while (currentCandidate)
  currentCandidatePath.points.reverse()
  currentCandidatePath.points.unshift(startPoint)

  graphics.lines!.push(currentCandidatePath)

  for (const candidate of candidates) {
    graphics.points!.push({
      ...candidate.port.d,
      color: "rgb(0, 64, 255)",
      label: `g: ${candidate.g}\nh: ${candidate.h}\nf: ${candidate.f}\nripRequired: ${candidate.ripRequired}`,
    })
  }

  return graphics
}

const visualizeTypedConnections = (
  connections: TypedConnection[],
): GraphicsObject => {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
  }

  for (const connection of connections) {
    const startCenter = connection.startRegion.d.center
    const endCenter = connection.endRegion.d.center
    const midX = (startCenter.x + endCenter.x) / 2
    const midY = (startCenter.y + endCenter.y) / 2
    graphics.points!.push({
      x: midX,
      y: midY,
      color: "rgba(255, 50, 150, 0.8)",
      label: connection.connectionId,
    })
    graphics.lines!.push({
      points: [startCenter, endCenter],
      strokeColor: "rgba(255, 50, 150, 0.2)",
      strokeWidth: 0.05,
    })
  }
  return graphics
}

const visualizeTypedHyperGraph = (graph: TypedHyperGraph): GraphicsObject => {
  const graphics: GraphicsObject = {
    rects: [],
    points: [],
  }

  for (const region of graph.regions) {
    graphics.rects!.push({
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      fill: "rgba(200, 200, 200, 0.5)",
      label: region.regionId,
    })
  }

  for (const port of graph.ports) {
    graphics.points!.push({
      x: port.d.x,
      y: port.d.y,
      color: "rgba(4, 90, 20, 0.3)",
      label: port.portId,
    })
  }

  return graphics
}

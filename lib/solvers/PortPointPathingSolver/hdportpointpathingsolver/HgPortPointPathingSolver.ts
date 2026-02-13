import {
  HyperGraphSolver,
  type Candidate,
  type RegionPortAssignment,
  type SolvedRoute,
} from "@tscircuit/hypergraph"
import { distance, doSegmentsIntersect } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
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
import type { Connection, HyperGraph } from "@tscircuit/hypergraph"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

const MAX_CANDIDATES_PER_REGION = 2

export const SOLVER_DEFAULTS = {
  portUsagePenalty: 0.15,
  crossingPenalty: 0.6,
  ripCost: 8.5,
  greedyMultiplier: 0.7,
  ripNodePfThresholdStart: 0.3,
  maxNodeRips: 100,
}

export interface HgPortPointPathingSolverParams {
  inputGraph: HyperGraph
  inputConnections: Connection[]
  connectionsWithResults: ConnectionPathResult[]
  inputNodes: InputNodeWithPortPoints[]
  portPointMap: Map<string, InputPortPoint>
  greedyMultiplier?: number
  ripCost?: number
  rippingEnabled?: boolean
  portUsagePenalty?: number
  regionTransitionPenalty?: number
  ripNodePfThresholdStart?: number
  maxNodeRips?: number
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
  nodeRipCountMap: Map<CapacityMeshNodeId, number> = new Map()

  constructor({
    inputGraph,
    inputConnections,
    connectionsWithResults,
    inputNodes,
    portPointMap,
    greedyMultiplier,
    ripCost,
    rippingEnabled,
    portUsagePenalty,
    regionTransitionPenalty,
    ripNodePfThresholdStart,
    maxNodeRips,
  }: HgPortPointPathingSolverParams) {
    super({
      inputGraph,
      inputConnections,
      greedyMultiplier: greedyMultiplier ?? SOLVER_DEFAULTS.greedyMultiplier,
      rippingEnabled: rippingEnabled ?? true,
      ripCost: ripCost ?? SOLVER_DEFAULTS.ripCost,
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

    this.portUsagePenalty = portUsagePenalty ?? SOLVER_DEFAULTS.portUsagePenalty
    this.regionTransitionPenalty =
      regionTransitionPenalty ?? SOLVER_DEFAULTS.crossingPenalty
    this.ripNodePfThresholdStart =
      ripNodePfThresholdStart ?? SOLVER_DEFAULTS.ripNodePfThresholdStart
    this.maxNodeRips = maxNodeRips ?? SOLVER_DEFAULTS.maxNodeRips
    this.MAX_ITERATIONS = 200000
  }

  override estimateCostToEnd(port: HgPort): number {
    const endCenter = this.currentEndRegion?.d?.center
    if (!endCenter) return 0
    return distance({ x: port.d.x, y: port.d.y }, endCenter)
  }

  override computeH(candidate: Candidate<HgRegion, HgPort>): number {
    const distanceToEnd = this.estimateCostToEnd(candidate.port)
    const centerBias = candidate.port.d.distToCentermostPortOnZ ?? 0
    return distanceToEnd + centerBias * 0.05
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

    return assignments.filter((assignment) => {
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

    if (filteredCandidates.length <= MAX_CANDIDATES_PER_REGION) {
      return filteredCandidates
    }

    return filteredCandidates
      .slice()
      .sort((a, b) => a.g + a.h - (b.g + b.h))
      .slice(0, MAX_CANDIDATES_PER_REGION)
  }

  override routeSolvedHook(solvedRoute: SolvedRoute): void {
    if (!solvedRoute.requiredRip) return
    if (this.unprocessedConnections.length < 2) return
    const [next, ...rest] = this.unprocessedConnections
    this.unprocessedConnections = [...rest, next]
  }

  override _step(): void {
    super._step()
    this.buildAssignmentsIfSolved()
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
    return startRippingPfThreshold * nodeRipFraction + 1 * (1 - nodeRipFraction)
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

  private selectNodeForRipping({
    candidateNodesForRipping,
    random,
  }: {
    candidateNodesForRipping: Array<{
      nodeId: CapacityMeshNodeId
      pf: number
      routesInNode: SolvedRoute[]
    }>
    random: () => number
  }) {
    const totalPfWeight = candidateNodesForRipping.reduce(
      (weightSum, node) => weightSum + Math.max(0, node.pf),
      0,
    )
    if (totalPfWeight <= 0) return null

    let remainingWeight = random() * totalPfWeight
    for (const node of candidateNodesForRipping) {
      remainingWeight -= Math.max(0, node.pf)
      if (remainingWeight <= 0) {
        return node
      }
    }

    return candidateNodesForRipping[candidateNodesForRipping.length - 1] ?? null
  }

  override computeRoutesToRip(newlySolvedRoute: SolvedRoute): Set<SolvedRoute> {
    const portOverlapRoutesToRip = super.computePortOverlapRoutes(
      newlySolvedRoute,
    )
    const routesToRip = new Set<SolvedRoute>(portOverlapRoutesToRip)
    const crossingRoutesByNode =
      this.getCrossingRoutesByNodeForPath(newlySolvedRoute)
    const rippingRandomSeed = this.iterations + this.solvedRoutes.length
    const random = seededRandom(rippingRandomSeed)

    const candidateNodesForRipping = Array.from(crossingRoutesByNode.entries())
      .map(([nodeId, crossingRoutes]) => {
        const region = this.regionMap.get(nodeId)
        if (!region) return null

        const availableRoutesInNode = Array.from(crossingRoutes).filter(
          (route) => !routesToRip.has(route),
        )
        if (availableRoutesInNode.length === 0) return null

        const currentPf = this.computeNodePfForRegion({
          region,
          newlySolvedRoute,
          routesToRip,
        })
        const rippingPfThreshold = this.getNodeRippingPfThreshold(nodeId)
        if (currentPf <= rippingPfThreshold) return null

        return {
          nodeId,
          pf: currentPf,
          routesInNode: availableRoutesInNode,
        }
      })
      .filter(
        (
          node,
        ): node is {
          nodeId: CapacityMeshNodeId
          pf: number
          routesInNode: SolvedRoute[]
        } => Boolean(node),
      )

    const selectedNode = this.selectNodeForRipping({
      candidateNodesForRipping,
      random,
    })
    if (!selectedNode) {
      return routesToRip
    }

    const selectedRouteIndex = Math.min(
      selectedNode.routesInNode.length - 1,
      Math.floor(random() * selectedNode.routesInNode.length),
    )
    const selectedRoute = selectedNode.routesInNode[selectedRouteIndex]
    routesToRip.add(selectedRoute)

    const nodeRipCount = this.nodeRipCountMap.get(selectedNode.nodeId) ?? 0
    this.nodeRipCountMap.set(selectedNode.nodeId, nodeRipCount + 1)

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

    return calculateNodeProbabilityOfFailure(
      capacityMeshNode,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  visualize(): GraphicsObject {
    return visualizeHgPortPointPathingSolver(this)
  }
}

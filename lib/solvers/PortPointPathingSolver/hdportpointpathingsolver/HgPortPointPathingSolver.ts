import {
  HyperGraphSolver,
  type Candidate,
  type RegionPortAssignment,
  type SolvedRoute,
} from "@tscircuit/hypergraph"
import { distance, doSegmentsIntersect } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNodeId } from "lib/types"
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

const MAX_CANDIDATES_PER_REGION = 2

export const SOLVER_DEFAULTS = {
  portUsagePenalty: 0.15,
  crossingPenalty: 0.6,
  ripCost: 8.5,
  greedyMultiplier: 0.7,
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
}

export class HgPortPointPathingSolver extends HyperGraphSolver<
  HgRegion,
  HgPort
> {
  inputNodes: InputNodeWithPortPoints[]
  nodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>
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
    this.portPointMap = portPointMap
    this.connectionsWithResults = connectionsWithResults

    this.portUsagePenalty = portUsagePenalty ?? SOLVER_DEFAULTS.portUsagePenalty
    this.regionTransitionPenalty =
      regionTransitionPenalty ?? SOLVER_DEFAULTS.crossingPenalty
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
    if (candidates.length <= MAX_CANDIDATES_PER_REGION) return candidates
    return candidates
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

  visualize(): GraphicsObject {
    return visualizeHgPortPointPathingSolver(this)
  }
}

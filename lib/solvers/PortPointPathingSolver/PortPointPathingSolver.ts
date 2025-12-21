import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../../types"
import type { GraphicsObject } from "graphics-debug"
import { distance } from "@tscircuit/math-utils"
import { calculateNodeProbabilityOfFailure } from "../UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import type {
  PortPoint,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { visualizePointPathSolver } from "./visualizePointPathSolver"
import {
  cloneAndShuffleArray,
  seededRandom,
} from "lib/utils/cloneAndShuffleArray"

export interface PortPointPathingHyperParameters {
  SHUFFLE_SEED?: number
  CENTER_OFFSET_DIST_PENALTY_FACTOR?: number
  CENTER_OFFSET_FOCUS_SHIFT?: number
  GREEDY_MULTIPLIER?: number
  NODE_PF_FACTOR?: number
  RANDOM_COST_MAGNITUDE?: number
  NODE_PF_MAX_PENALTY?: number

  MEMORY_PF_FACTOR?: number
  BASE_CANDIDATE_COST?: number

  MAX_ITERATIONS_PER_PATH?: number
}

/**
 * An input port point without connectionName assigned yet.
 * These are pre-computed points on node edges where traces can cross.
 */
export interface InputPortPoint {
  portPointId: string
  x: number
  y: number
  z: number
  /** The node IDs that this port point connects (on the shared edge) */
  connectionNodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
  /** XY distance to the centermost port on this Z level (centermost port has distance 0) */
  distToCentermostPortOnZ: number
}

/**
 * A node with pre-computed port points (without connectionName assigned).
 * This is the input format for PortPointPathingSolver.
 */
export interface InputNodeWithPortPoints {
  capacityMeshNodeId: CapacityMeshNodeId
  center: { x: number; y: number }
  width: number
  height: number
  /** Port points on this node's edges (without connectionName) */
  portPoints: InputPortPoint[]
  availableZ: number[]
  /** If true, this node is a target node (contains a connection endpoint) */
  _containsTarget?: boolean
  /** If true, this node contains an obstacle */
  _containsObstacle?: boolean
}

/**
 * A candidate in the A* search. Represents being at a port point,
 * having entered from a specific node.
 */
export interface PortPointCandidate {
  prevCandidate: PortPointCandidate | null
  /** The port point we're at (null for start/end target points) */
  portPoint: InputPortPoint | null
  /** The node we're currently in (entered via portPoint) */
  currentNodeId: CapacityMeshNodeId
  /** The physical point location (entry point within currentNodeId) */
  point: { x: number; y: number }
  /** The z layer this candidate is on */
  z: number
  f: number
  g: number
  h: number
}

export interface ConnectionPathResult {
  connection: SimpleRouteConnection
  /** Start and end node IDs */
  nodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
  /** The path of candidates found by the pathing algorithm */
  path?: PortPointCandidate[]
  /** Port points used by this connection (with connectionName assigned) */
  portPoints?: PortPoint[]
  straightLineDistance: number
}

/**
 * PortPointPathingSolver finds paths through the capacity mesh by visiting
 * pre-computed port points on shared edges. It considers layer information
 * when routing and uses a Pf-based cost function.
 *
 * Improvements in this implementation:
 *  - g is now an *exact* accumulated path cost (incremental delta Pf per node, computed only when a node is "closed")
 *  - node Pf contribution is charged when you *leave* a node (entry+exit known), not when entering the next node
 *  - uses a log-success style cost: cost(pf) = -log(1 - pf), and delta = cost(after) - cost(before)
 *  - caches base node costs and segment delta costs to avoid repeated crossing computations
 *  - computeH uses memoryPf + distance to approximate remaining cost (and can be tuned)
 *  - closes the end node when connecting to the final end target point
 *  - prevents node cycles in a candidate chain (keeps Pf math correct without needing per-node multi-visit tracking)
 */
export class PortPointPathingSolver extends BaseSolver {
  hyperParameters: Partial<PortPointPathingHyperParameters>

  simpleRouteJson: SimpleRouteJson
  inputNodes: InputNodeWithPortPoints[]

  nodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>
  /** Map from nodeId to list of port points accessible from that node */
  nodePortPointsMap: Map<CapacityMeshNodeId, InputPortPoint[]>
  /** Map from portPointId to InputPortPoint */
  portPointMap: Map<string, InputPortPoint>

  connectionsWithResults: ConnectionPathResult[] = []

  /** Tracks port points that have been assigned to connections */
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  > = new Map()

  /** Tracks port points assigned to each node for crossing calculations */
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]> = new Map()

  /** Factor applied to port point reuse penalty */
  PORT_POINT_REUSE_FACTOR = 1000

  /** Multiplied by Pf delta cost (in -log(1-pf) space) */
  get NODE_PF_FACTOR() {
    return this.hyperParameters.NODE_PF_FACTOR ?? 50
  }

  /** Used only in heuristic (h) to "look ahead" into known-congested regions */
  get MEMORY_PF_FACTOR() {
    return this.hyperParameters.MEMORY_PF_FACTOR ?? 0
  }

  get CENTER_OFFSET_FOCUS_SHIFT() {
    return this.hyperParameters.CENTER_OFFSET_FOCUS_SHIFT ?? 0
  }

  /** Used as a *tie-breaker* in f (not part of g) */
  get RANDOM_COST_MAGNITUDE() {
    return this.hyperParameters.RANDOM_COST_MAGNITUDE ?? 0
  }

  /** Cost of adding a candidate to the path */
  get BASE_CANDIDATE_COST() {
    return this.hyperParameters.BASE_CANDIDATE_COST ?? 0
  }

  get NODE_PF_MAX_PENALTY() {
    return this.hyperParameters.NODE_PF_MAX_PENALTY ?? 10_000
  }

  /** Penalty factor for port points that are far from the center of the segment */
  get CENTER_OFFSET_DIST_PENALTY_FACTOR() {
    return this.hyperParameters.CENTER_OFFSET_DIST_PENALTY_FACTOR ?? 0
  }

  colorMap: Record<string, string>

  get GREEDY_MULTIPLIER() {
    return this.hyperParameters.GREEDY_MULTIPLIER ?? 1.3
  }

  MAX_CANDIDATES_IN_MEMORY = 50_000

  get MAX_ITERATIONS_PER_PATH() {
    return this.hyperParameters.MAX_ITERATIONS_PER_PATH ?? 4000
  }

  nodeMemoryPfMap: Map<CapacityMeshNodeId, number>

  // Current pathing state
  currentConnectionIndex = 0
  currentPathIterations = 0
  candidates?: PortPointCandidate[] | null
  /** Tracks visited port point IDs to avoid revisiting */
  visitedPortPoints?: Set<string> | null
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>

  capacityMeshNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>

  /** Heuristic scaling: an estimate of "node pitch" used to estimate remaining hops */
  avgNodePitch = 1

  /** Cache of base node cost (cost of node in current committed state) */
  private baseNodeCostCache = new Map<CapacityMeshNodeId, number>()
  /** Cache of delta cost for a specific node segment (entry->exit) for a specific connection */
  private segmentDeltaCostCache = new Map<string, number>()

  constructor({
    simpleRouteJson,
    inputNodes,
    capacityMeshNodes,
    colorMap,
    nodeMemoryPfMap,
    hyperParameters,
  }: {
    simpleRouteJson: SimpleRouteJson
    capacityMeshNodes: CapacityMeshNode[]
    inputNodes: InputNodeWithPortPoints[]
    colorMap?: Record<string, string>
    nodeMemoryPfMap?: Map<CapacityMeshNodeId, number>
    hyperParameters?: Partial<PortPointPathingHyperParameters>
  }) {
    super()
    this.MAX_ITERATIONS = 50e3
    this.simpleRouteJson = simpleRouteJson
    this.inputNodes = inputNodes
    this.colorMap = colorMap ?? {}
    this.capacityMeshNodeMap = new Map(
      capacityMeshNodes.map((n) => [n.capacityMeshNodeId, n]),
    )
    this.nodeMemoryPfMap = nodeMemoryPfMap ?? new Map()
    this.hyperParameters = hyperParameters ?? {}
    this.nodeMap = new Map(inputNodes.map((n) => [n.capacityMeshNodeId, n]))

    // Compute a rough node pitch to convert distance into estimated hops for heuristic
    const pitches = inputNodes
      .map((n) => (n.width + n.height) / 2)
      .filter((x) => Number.isFinite(x) && x > 0)
    this.avgNodePitch =
      pitches.length > 0
        ? pitches.reduce((a, b) => a + b, 0) / pitches.length
        : 1

    // Build port point maps
    this.portPointMap = new Map()
    this.nodePortPointsMap = new Map()

    for (const node of inputNodes) {
      this.nodePortPointsMap.set(node.capacityMeshNodeId, [])
      this.nodeAssignedPortPoints.set(node.capacityMeshNodeId, [])
    }

    for (const node of inputNodes) {
      for (const pp of node.portPoints) {
        this.portPointMap.set(pp.portPointId, pp)

        // Add to both nodes that share this port point
        for (const nodeId of pp.connectionNodeIds) {
          const nodePortPoints = this.nodePortPointsMap.get(nodeId)
          if (
            nodePortPoints &&
            !nodePortPoints.some((p) => p.portPointId === pp.portPointId)
          ) {
            nodePortPoints.push(pp)
          }
        }
      }
    }

    const { connectionsWithResults, connectionNameToGoalNodeIds } =
      this.getConnectionsWithNodes()
    this.connectionsWithResults = connectionsWithResults
    this.connectionNameToGoalNodeIds = connectionNameToGoalNodeIds
  }

  private clearCostCaches() {
    this.baseNodeCostCache.clear()
    this.segmentDeltaCostCache.clear()
  }

  private clampPf(pf: number): number {
    if (!Number.isFinite(pf)) return 0.999999
    // pf estimator can exceed 1. Clamp to keep log stable.
    return Math.min(Math.max(pf, 0), 0.999999)
  }

  /** Convert Pf into an additive "failure cost" */
  private pfToFailureCost(pf: number): number {
    const p = this.clampPf(pf)
    // -log(1-p) is 0 at p=0 and increases quickly as p->1
    return -Math.log(1 - p)
  }

  private round3(n: number): number {
    return Math.round(n * 1000) / 1000
  }

  private pointKey(p: { x: number; y: number }, z: number): string {
    return `${this.round3(p.x)},${this.round3(p.y)},${z}`
  }

  /** Base node cost with the currently-committed port points (no candidate additions) */
  private getBaseNodeFailureCost(nodeId: CapacityMeshNodeId): number {
    const cached = this.baseNodeCostCache.get(nodeId)
    if (cached != null) return cached

    const node = this.nodeMap.get(nodeId)
    if (!node) return 0

    const pfBefore = this.computeNodePf(node)
    const baseCost = this.pfToFailureCost(pfBefore)
    this.baseNodeCostCache.set(nodeId, baseCost)
    return baseCost
  }

  /**
   * Exact delta cost of routing this connection through `nodeId`
   * for the segment defined by entry->exit.
   *
   * This is computed as:
   *   delta = (-log(1-pfAfter)) - (-log(1-pfBefore))
   * and then scaled by NODE_PF_FACTOR.
   */
  private getNodeDeltaFailureCostForSegment(
    nodeId: CapacityMeshNodeId,
    entry: PortPoint,
    exit: PortPoint,
  ): number {
    const key = `${nodeId}|${this.pointKey(
      { x: entry.x, y: entry.y },
      entry.z,
    )}|${this.pointKey(
      { x: exit.x, y: exit.y },
      exit.z,
    )}|${entry.connectionName}|${entry.rootConnectionName ?? ""}`

    const cached = this.segmentDeltaCostCache.get(key)
    if (cached != null) return cached

    const node = this.nodeMap.get(nodeId)
    if (!node) return 0

    const baseCost = this.getBaseNodeFailureCost(nodeId)

    const pfAfter = this.computeNodePf(node, [entry, exit])
    const afterCost = this.pfToFailureCost(pfAfter)

    // If the estimator ever yields a lower Pf after adding points, don't reward it here.
    const delta = Math.max(0, afterCost - baseCost)

    this.segmentDeltaCostCache.set(key, delta)
    // console.log(this.iterations, { nodeId, entry, exit })
    // if (nodeId === "cmn_8" && exit.z === 1 && this.iterations >= 26) {
    //   debugger
    // }
    return delta * this.NODE_PF_FACTOR
  }

  getConnectionsWithNodes() {
    let connectionsWithResults: ConnectionPathResult[] = []
    const nodesWithTargets = this.inputNodes.filter((n) => n._containsTarget)
    const connectionNameToGoalNodeIds = new Map<string, CapacityMeshNodeId[]>()

    for (const connection of this.simpleRouteJson.connections) {
      const nodesForConnection: InputNodeWithPortPoints[] = []

      for (const point of connection.pointsToConnect) {
        let closestNode = this.inputNodes[0]
        let minDistance = Number.MAX_VALUE

        for (const node of nodesWithTargets) {
          const dist = Math.sqrt(
            (node.center.x - point.x) ** 2 + (node.center.y - point.y) ** 2,
          )
          if (dist < minDistance) {
            minDistance = dist
            closestNode = node
          }
        }
        nodesForConnection.push(closestNode)
      }

      if (nodesForConnection.length < 2) {
        throw new Error(
          `Not enough nodes for connection "${connection.name}", only ${nodesForConnection.length} found`,
        )
      }

      connectionNameToGoalNodeIds.set(
        connection.name,
        nodesForConnection.map((n) => n.capacityMeshNodeId),
      )

      connectionsWithResults.push({
        connection,
        nodeIds: [
          nodesForConnection[0].capacityMeshNodeId,
          nodesForConnection[nodesForConnection.length - 1].capacityMeshNodeId,
        ],
        straightLineDistance: distance(
          nodesForConnection[0].center,
          nodesForConnection[nodesForConnection.length - 1].center,
        ),
      })
    }

    connectionsWithResults = cloneAndShuffleArray(
      connectionsWithResults,
      this.hyperParameters.SHUFFLE_SEED ?? 0,
    )

    return { connectionsWithResults, connectionNameToGoalNodeIds }
  }

  /**
   * Build a NodeWithPortPoints structure for crossing calculation.
   */
  buildNodeWithPortPointsForCrossing(
    node: InputNodeWithPortPoints,
    additionalPortPoints?: PortPoint[],
  ): NodeWithPortPoints {
    const existingPortPoints =
      this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []
    const allPortPoints = additionalPortPoints
      ? [...existingPortPoints, ...additionalPortPoints]
      : existingPortPoints

    return {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints: allPortPoints,
      availableZ: node.availableZ,
    }
  }

  /**
   * Compute probability of failure for a node using getIntraNodeCrossings.
   */
  computeNodePf(
    node: InputNodeWithPortPoints,
    additionalPortPoints?: PortPoint[],
  ): number {
    if (node._containsTarget) return 0

    const nodeWithPortPoints = this.buildNodeWithPortPointsForCrossing(
      node,
      additionalPortPoints,
    )
    const crossings = getIntraNodeCrossings(nodeWithPortPoints)

    return calculateNodeProbabilityOfFailure(
      this.capacityMeshNodeMap.get(node.capacityMeshNodeId)!,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  /**
   * Get penalty for reusing a port point that's already assigned.
   * No penalty if the port point is assigned to a connection with the same rootConnectionName.
   */
  getPortPointReusePenalty(
    portPointId: string,
    rootConnectionName?: string,
  ): number {
    const assigned = this.assignedPortPoints.get(portPointId)
    if (!assigned) return 0
    if (rootConnectionName === assigned.rootConnectionName) return 0
    return this.PORT_POINT_REUSE_FACTOR
  }

  /**
   * Get the node on the "other side" of a port point from the given node
   */
  getOtherNodeId(
    portPoint: InputPortPoint,
    currentNodeId: CapacityMeshNodeId,
  ): CapacityMeshNodeId | null {
    const [nodeId1, nodeId2] = portPoint.connectionNodeIds
    if (nodeId1 === currentNodeId) return nodeId2
    if (nodeId2 === currentNodeId) return nodeId1
    return null
  }

  /**
   * Exact step cost from prevCandidate to exiting current node via `exitPortPoint`.
   *
   * IMPORTANT: This charges Pf delta for the node we are *leaving* (prevCandidate.currentNodeId),
   * because only then we know both entry and exit points inside that node.
   */
  computeG(
    prevCandidate: PortPointCandidate,
    exitPortPoint: InputPortPoint,
    _targetNodeId: CapacityMeshNodeId,
    connectionName: string,
    rootConnectionName?: string,
  ): number {
    const leavingNodeId = prevCandidate.currentNodeId
    const prevPoint = prevCandidate.point

    const entry: PortPoint = {
      x: prevPoint.x,
      y: prevPoint.y,
      z: prevCandidate.z,
      connectionName,
      rootConnectionName,
    }

    const exit: PortPoint = {
      x: exitPortPoint.x,
      y: exitPortPoint.y,
      z: exitPortPoint.z,
      connectionName,
      rootConnectionName,
    }

    const nodeDeltaCost = this.getNodeDeltaFailureCostForSegment(
      leavingNodeId,
      entry,
      exit,
    )

    return prevCandidate.g + nodeDeltaCost
  }

  /**
   * Final "close" cost when you're already in the end node and you connect to the end target point.
   * This ensures the last node's segment is accounted for in g.
   */
  private computeGToEndTarget(
    candidateAtEndNode: PortPointCandidate,
    endPoint: { x: number; y: number },
    connectionName: string,
    rootConnectionName?: string,
  ): number {
    const endNodeId = candidateAtEndNode.currentNodeId

    const entry: PortPoint = {
      x: candidateAtEndNode.point.x,
      y: candidateAtEndNode.point.y,
      z: candidateAtEndNode.z,
      connectionName,
      rootConnectionName,
    }
    const exit: PortPoint = {
      x: endPoint.x,
      y: endPoint.y,
      z: candidateAtEndNode.z,
      connectionName,
      rootConnectionName,
    }

    const nodeDeltaCost = this.getNodeDeltaFailureCostForSegment(
      endNodeId,
      entry,
      exit,
    )

    return candidateAtEndNode.g + nodeDeltaCost
  }

  /**
   * Heuristic: approximate remaining cost.
   *
   * Uses:
   *  - distance to goal
   *  - estimated remaining hops (distance / avgNodePitch)
   *  - memoryPfMap to bias away from historically high Pf regions
   */
  computeH(
    point: { x: number; y: number },
    currentNodeId: CapacityMeshNodeId,
    endGoalNodeId: CapacityMeshNodeId,
    currentZ: number,
  ): number {
    const endNode = this.nodeMap.get(endGoalNodeId)
    if (!endNode) return 0

    const distanceToGoal = distance(point, endNode.center)
    const estHops =
      this.avgNodePitch > 0 ? distanceToGoal / this.avgNodePitch : 0

    const memPf = this.clampPf(this.nodeMemoryPfMap.get(currentNodeId) ?? 0)

    // Convert memory Pf into an additive cost per hop (same log-space)
    const memRiskForHop = this.pfToFailureCost(memPf) * this.MEMORY_PF_FACTOR

    // Estimate the remaining "step costs"
    const estStepCost = estHops * this.BASE_CANDIDATE_COST

    return distanceToGoal + estStepCost + memRiskForHop
  }

  getAvailableExitPortPoints(nodeId: CapacityMeshNodeId) {
    const currentConnection =
      this.connectionsWithResults[this.currentConnectionIndex]
    const currentRootConnectionName =
      currentConnection?.connection.rootConnectionName
    const portPoints = this.nodePortPointsMap.get(nodeId) ?? []

    const availablePortPoints: InputPortPoint[] = []

    for (const pp of portPoints) {
      if (this.visitedPortPoints?.has(pp.portPointId)) continue
      const assignment = this.assignedPortPoints.get(pp.portPointId)
      if (
        assignment &&
        assignment?.rootConnectionName !== currentRootConnectionName
      ) {
        continue
      }
      availablePortPoints.push(pp)
    }

    return availablePortPoints
  }

  /**
   * Get available port points to exit from a node, but *do not* return all.
   *
   * Rule:
   * - For each (neighborNodeId, z) group, return the centermost (smallest dist).
   * - If that centermost port point is already assigned, also return some next-closest
   *   unassigned offsets as backups.
   */
  getAvailableExitPortPointsWithOmissions(
    nodeId: CapacityMeshNodeId,
    _endGoalNodeId: CapacityMeshNodeId,
  ): InputPortPoint[] {
    const portPoints = this.nodePortPointsMap.get(nodeId) ?? []
    const currentConnection =
      this.connectionsWithResults[this.currentConnectionIndex]
    const currentRootConnectionName =
      currentConnection?.connection.rootConnectionName

    // Group by "other side node" + z
    const groups = new Map<string, InputPortPoint[]>()

    for (const pp of portPoints) {
      if (this.visitedPortPoints?.has(pp.portPointId)) continue

      const otherNodeId = this.getOtherNodeId(pp, nodeId)
      if (!otherNodeId) continue

      const key = `${otherNodeId}|${pp.z}`
      const arr = groups.get(key) ?? []
      arr.push(pp)
      groups.set(key, arr)
    }

    const result: InputPortPoint[] = []

    for (const [, group] of groups) {
      // Sort by "center offset distance" (0 first)
      group.sort(
        (a, b) => a.distToCentermostPortOnZ - b.distToCentermostPortOnZ,
      )

      const center = group[0]
      if (!center) continue

      // If center is already assigned, add adjacent offsets (next closest ones)
      const centerAssignment = this.assignedPortPoints.get(center.portPointId)
      const canBeReassignedBecauseSameNet =
        centerAssignment &&
        centerAssignment.rootConnectionName === currentRootConnectionName

      if (!centerAssignment || canBeReassignedBecauseSameNet) {
        result.push(center)
        continue
      }

      const unassignedOnSide: InputPortPoint[] = []
      for (let i = 1; i < group.length; i++) {
        if (this.assignedPortPoints.has(group[i].portPointId)) continue
        unassignedOnSide.push(group[i])
      }
      result.push(...unassignedOnSide)
    }

    return result
  }

  canTravelThroughObstacle(
    node: InputNodeWithPortPoints,
    connectionName: string,
  ): boolean {
    const goalNodeIds = this.connectionNameToGoalNodeIds.get(connectionName)
    return goalNodeIds?.includes(node.capacityMeshNodeId) ?? false
  }

  /**
   * Check if we've reached the end goal node
   */
  isAtEndGoal(
    currentNodeId: CapacityMeshNodeId,
    endGoalNodeId: CapacityMeshNodeId,
  ): boolean {
    return currentNodeId === endGoalNodeId
  }

  getBacktrackedPath(candidate: PortPointCandidate): PortPointCandidate[] {
    const path: PortPointCandidate[] = []
    let current: PortPointCandidate | null = candidate
    while (current) {
      path.push(current)
      current = current.prevCandidate
    }
    return path.reverse()
  }

  /**
   * Assign port points along a path and record which connections use them.
   */
  assignPortPointsForPath(
    path: PortPointCandidate[],
    connectionName: string,
    rootConnectionName?: string,
  ): PortPoint[] {
    const assignedPortPoints: PortPoint[] = []

    for (const candidate of path) {
      if (!candidate.portPoint) continue // Skip start/end target points

      const pp = candidate.portPoint

      // Mark port point as assigned
      this.assignedPortPoints.set(pp.portPointId, {
        connectionName,
        rootConnectionName,
      })

      const portPoint: PortPoint = {
        x: pp.x,
        y: pp.y,
        z: pp.z,
        connectionName,
        rootConnectionName,
      }

      assignedPortPoints.push(portPoint)

      // Add to both nodes for crossing calculations
      for (const nodeId of pp.connectionNodeIds) {
        const nodePortPoints = this.nodeAssignedPortPoints.get(nodeId) ?? []
        nodePortPoints.push(portPoint)
        this.nodeAssignedPortPoints.set(nodeId, nodePortPoints)
      }
    }

    return assignedPortPoints
  }

  /**
   * Add start/end target points to nodes for crossing calculations.
   */
  addTargetPointsToNodes(
    path: PortPointCandidate[],
    connection: SimpleRouteConnection,
  ) {
    const startCandidate = path[0]
    const endCandidate = path[path.length - 1]
    const startPoint = connection.pointsToConnect[0]
    const endPoint =
      connection.pointsToConnect[connection.pointsToConnect.length - 1]

    if (startCandidate && startPoint) {
      const startPortPoints =
        this.nodeAssignedPortPoints.get(startCandidate.currentNodeId) ?? []
      startPortPoints.push({
        x: startPoint.x,
        y: startPoint.y,
        z: startCandidate.z,
        connectionName: connection.name,
        rootConnectionName: connection.rootConnectionName,
      })
      this.nodeAssignedPortPoints.set(
        startCandidate.currentNodeId,
        startPortPoints,
      )
    }

    if (endCandidate && endPoint) {
      const endPortPoints =
        this.nodeAssignedPortPoints.get(endCandidate.currentNodeId) ?? []
      endPortPoints.push({
        x: endPoint.x,
        y: endPoint.y,
        z: endCandidate.z,
        connectionName: connection.name,
        rootConnectionName: connection.rootConnectionName,
      })
      this.nodeAssignedPortPoints.set(endCandidate.currentNodeId, endPortPoints)
    }
  }

  /**
   * Check if a port point is already in the candidate's path chain.
   */
  isPortPointInPathChain(
    candidate: PortPointCandidate | null,
    portPointId: string,
  ): boolean {
    let current = candidate
    while (current) {
      if (current.portPoint?.portPointId === portPointId) return true
      current = current.prevCandidate
    }
    return false
  }

  /**
   * Prevent node cycles in a single candidate chain.
   * This is important for correctness because we charge node cost as "one segment per node".
   */
  isNodeInPathChain(
    candidate: PortPointCandidate | null,
    nodeId: CapacityMeshNodeId,
  ): boolean {
    let current = candidate
    while (current) {
      if (current.currentNodeId === nodeId) return true
      current = current.prevCandidate
    }
    return false
  }

  _step() {
    const nextConnection =
      this.connectionsWithResults[this.currentConnectionIndex]
    if (!nextConnection) {
      this.solved = true
      return
    }

    // Check if we've exceeded max iterations for this path
    this.currentPathIterations++
    if (this.currentPathIterations > this.MAX_ITERATIONS_PER_PATH) {
      this.currentConnectionIndex++
      this.candidates = null
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      this.failed = true
      this.error = `Exceeded MAX_ITERATIONS_PER_PATH (${this.MAX_ITERATIONS_PER_PATH}) on connection ${nextConnection.connection.name}`
      return
    }

    const [startNodeId, endNodeId] = nextConnection.nodeIds
    const startNode = this.nodeMap.get(startNodeId)
    const endNode = this.nodeMap.get(endNodeId)
    if (!startNode || !endNode) {
      this.currentConnectionIndex++
      this.currentPathIterations = 0
      return
    }

    const connectionName = nextConnection.connection.name
    const rootConnectionName = nextConnection.connection.rootConnectionName
    const startPoint = nextConnection.connection.pointsToConnect[0]

    if (!this.candidates) {
      // New connection search: clear caches (base costs depend on committed state)
      this.clearCostCaches()

      // Create initial candidates for each available z layer on the start node
      this.candidates = []
      this.visitedPortPoints = new Set<string>()

      for (const z of startNode.availableZ) {
        const p = startPoint
          ? { x: startPoint.x, y: startPoint.y }
          : startNode.center

        const h = this.computeH(p, startNodeId, endNodeId, z)
        const f = 0 + h * this.GREEDY_MULTIPLIER

        this.candidates.push({
          prevCandidate: null,
          portPoint: null, // Start is at target point, not a port point
          currentNodeId: startNodeId,
          point: p,
          z,
          f,
          g: 0,
          h,
        })
      }
    }

    // Sort candidates by f value
    this.candidates.sort((a, b) => a.f - b.f)
    const currentCandidate = this.candidates.shift()

    // Limit memory usage
    if (this.candidates.length > this.MAX_CANDIDATES_IN_MEMORY) {
      this.candidates.splice(
        this.MAX_CANDIDATES_IN_MEMORY,
        this.candidates.length - this.MAX_CANDIDATES_IN_MEMORY,
      )
    }

    if (!currentCandidate) {
      this.error = `Ran out of candidates on connection ${connectionName}`
      this.currentConnectionIndex++
      this.candidates = null
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      this.failed = true
      return
    }

    // If we're at end goal node, close it by connecting to the end target point
    if (this.isAtEndGoal(currentCandidate.currentNodeId, endNodeId)) {
      const endPoint =
        nextConnection.connection.pointsToConnect[
          nextConnection.connection.pointsToConnect.length - 1
        ]
      const finalPoint = endPoint
        ? { x: endPoint.x, y: endPoint.y }
        : endNode.center

      const finalG = this.computeGToEndTarget(
        currentCandidate,
        finalPoint,
        connectionName,
        rootConnectionName,
      )

      const finalCandidate: PortPointCandidate = {
        prevCandidate: currentCandidate,
        portPoint: null,
        currentNodeId: endNodeId,
        point: finalPoint,
        z: currentCandidate.z,
        g: finalG,
        h: 0,
        f: finalG,
      }

      const path = this.getBacktrackedPath(finalCandidate)
      nextConnection.path = path
      nextConnection.portPoints = this.assignPortPointsForPath(
        path,
        connectionName,
        rootConnectionName,
      )

      // Add target points to nodes for crossing calculations
      this.addTargetPointsToNodes(path, nextConnection.connection)

      // Committed state changed -> invalidate caches
      this.clearCostCaches()

      this.currentConnectionIndex++
      this.candidates = null
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      return
    }

    // Expand to available port points from current node
    const availablePortPoints = this.getAvailableExitPortPointsWithOmissions(
      currentCandidate.currentNodeId,
      endNodeId,
    )

    for (const portPoint of availablePortPoints) {
      // Don't revisit port points in this path chain
      if (
        this.isPortPointInPathChain(currentCandidate, portPoint.portPointId)
      ) {
        continue
      }

      // Get the node we'd enter via this port point
      const targetNodeId = this.getOtherNodeId(
        portPoint,
        currentCandidate.currentNodeId,
      )
      if (!targetNodeId) continue

      // Prevent node cycles (keeps delta-pf accounting correct)
      if (this.isNodeInPathChain(currentCandidate, targetNodeId)) continue

      const targetNode = this.nodeMap.get(targetNodeId)
      if (!targetNode) continue

      // Check obstacle constraints
      if (
        targetNode._containsObstacle &&
        !this.canTravelThroughObstacle(targetNode, connectionName)
      ) {
        continue
      }

      const g = this.computeG(
        currentCandidate,
        portPoint,
        targetNodeId,
        connectionName,
        rootConnectionName,
      )

      const h = this.computeH(
        { x: portPoint.x, y: portPoint.y },
        targetNodeId,
        endNodeId,
        portPoint.z,
      )

      // Random tie-breaker influences ordering without contaminating g
      const tieBreaker =
        this.RANDOM_COST_MAGNITUDE * seededRandom(this.iterations)()

      const f = g + h * this.GREEDY_MULTIPLIER + tieBreaker

      this.candidates.push({
        prevCandidate: currentCandidate,
        portPoint,
        currentNodeId: targetNodeId,
        point: { x: portPoint.x, y: portPoint.y },
        z: portPoint.z,
        f,
        g,
        h,
      })
    }

    // Mark current port point as visited (if any)
    if (currentCandidate.portPoint && this.visitedPortPoints) {
      this.visitedPortPoints.add(currentCandidate.portPoint.portPointId)
    }
  }

  /**
   * Get the nodes with port points for the HighDensitySolver
   */
  getNodesWithPortPoints(): NodeWithPortPoints[] {
    const result: NodeWithPortPoints[] = []

    for (const node of this.inputNodes) {
      const assignedPortPoints =
        this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []

      if (assignedPortPoints.length > 0) {
        result.push({
          capacityMeshNodeId: node.capacityMeshNodeId,
          center: node.center,
          width: node.width,
          height: node.height,
          portPoints: assignedPortPoints,
          availableZ: node.availableZ,
        })
      }
    }

    return result
  }

  visualize(): GraphicsObject {
    return visualizePointPathSolver(this)
  }
}

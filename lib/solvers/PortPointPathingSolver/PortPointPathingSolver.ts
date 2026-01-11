import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../../types"
import { mergeGraphics, type GraphicsObject, type Line } from "graphics-debug"
import { distance, pointToSegmentDistance } from "@tscircuit/math-utils"
import { calculateNodeProbabilityOfFailure } from "../UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossingsUsingCircle } from "../../utils/getIntraNodeCrossingsUsingCircle"
import type {
  PortPoint,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { visualizePointPathSolver } from "./visualizePointPathSolver"
import {
  cloneAndShuffleArray,
  seededRandom,
} from "lib/utils/cloneAndShuffleArray"
import { computeSectionScore } from "../MultiSectionPortPointOptimizer"
import {
  type PrecomputedInitialParams,
  clonePrecomputedMutableParams,
} from "./precomputeSharedParams"
import { getConnectionsWithNodes as getConnectionsWithNodesShared } from "./getConnectionsWithNodes"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import { computeSectionScoreWithJumpers } from "../MultiSectionPortPointOptimizer/computeSectionScoreWithJumpers"
import { calculateNodeProbabilityOfFailureWithJumpers } from "../MultiSectionPortPointOptimizer/calculateNodeProbabilityOfFailureWithJumpers"

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
  MIN_ALLOWED_BOARD_SCORE?: number

  MAX_ITERATIONS_PER_PATH?: number
  FORCE_CENTER_FIRST?: boolean

  RANDOM_WALK_DISTANCE?: number

  FORCE_OFF_BOARD_FREQUENCY?: number
  FORCE_OFF_BOARD_SEED?: number

  RIPPING_ENABLED?: boolean
  RIPPING_PF_THRESHOLD?: number
  MAX_RIPS?: number
  RANDOM_RIP_FRACTION?: number

  /** When enabled, use jumper-based pf calculation for same-layer crossings on single layer nodes */
  JUMPER_PF_FN_ENABLED?: boolean

  /** Factor for penalizing deviation from straight line path */
  STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR?: number
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

  connectsToOffBoardNode?: boolean
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

  _offBoardConnectionId?: string
  _offBoardConnectedCapacityMeshNodeIds?: CapacityMeshNodeId[]
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
  /** Total distance traveled from start to this candidate */
  distanceTraveled: number
  /** Whether this candidate has ever crossed through an off-board node */
  hasTouchedOffBoardNode?: boolean

  lastMoveWasOffBoard?: boolean
  /** The node we went through when making an off-board move */
  throughNodeId?: CapacityMeshNodeId
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

  failedConnection: ConnectionPathResult | null = null

  /** Tracks port points that have been assigned to connections */
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  > = new Map()

  /** Tracks port points assigned to each node for crossing calculations */
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]> = new Map()

  /** Factor applied to port point reuse penalty */
  PORT_POINT_REUSE_FACTOR = 1000

  /**
   * Cost when a node doesn't go off board when it's supposed to w/ the
   * FORCE_OFF_BOARD_FREQUENCY setting.
   */
  BASE_COST_FOR_NOT_GOING_OFF_BOARD = 100

  /** Multiplied by Pf delta cost (in -log(1-pf) space) */
  get NODE_PF_FACTOR() {
    return this.hyperParameters.NODE_PF_FACTOR ?? 50
  }

  get RANDOM_WALK_DISTANCE() {
    return this.hyperParameters.RANDOM_WALK_DISTANCE ?? 0
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

  get FORCE_CENTER_FIRST() {
    return this.hyperParameters.FORCE_CENTER_FIRST ?? true
  }

  get FORCE_OFF_BOARD_FREQUENCY() {
    if (this.offBoardNodes.length === 0) return 0
    return this.hyperParameters.FORCE_OFF_BOARD_FREQUENCY ?? 0
  }

  get FORCE_OFF_BOARD_SEED() {
    return this.hyperParameters.FORCE_OFF_BOARD_SEED ?? 0
  }

  get NODE_MAX_PF() {
    const NODE_MAX_PF = Math.min(
      0.99999,
      1 - Math.exp(-this.NODE_PF_MAX_PENALTY),
    )
    return NODE_MAX_PF
  }

  /** Penalty factor for port points that are far from the center of the segment */
  get CENTER_OFFSET_DIST_PENALTY_FACTOR() {
    return this.hyperParameters.CENTER_OFFSET_DIST_PENALTY_FACTOR ?? 0
  }

  get STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR() {
    return this.hyperParameters.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR ?? 0
  }

  colorMap: Record<string, string>

  get GREEDY_MULTIPLIER() {
    return this.hyperParameters.GREEDY_MULTIPLIER ?? 1.3
  }

  MAX_CANDIDATES_IN_MEMORY = 5000

  get MAX_ITERATIONS_PER_PATH() {
    return this.hyperParameters.MAX_ITERATIONS_PER_PATH ?? 10000
  }

  ITERATIONS_PER_MM_FOR_PATH = 30
  BASE_ITERATIONS_PER_PATH = 10000

  get RIPPING_ENABLED() {
    return this.hyperParameters.RIPPING_ENABLED ?? false
  }

  get RIPPING_PF_THRESHOLD() {
    return this.hyperParameters.RIPPING_PF_THRESHOLD ?? 0.3
  }

  get MAX_RIPS() {
    return this.hyperParameters.MAX_RIPS ?? 100
  }

  get RANDOM_RIP_FRACTION() {
    return this.hyperParameters.RANDOM_RIP_FRACTION ?? 0
  }

  get JUMPER_PF_FN_ENABLED() {
    return this.hyperParameters.JUMPER_PF_FN_ENABLED ?? false
  }

  /** Number of jumpers that can fit per mm² of node area */
  jumpersPerMmSquared = 0.1

  /** Tracks which connections have been test-ripped for each node to avoid retesting */
  testedRipConnections: Map<CapacityMeshNodeId, Set<string>> = new Map()

  /** Tracks total number of connections that have been ripped/requeued */
  totalRipCount = 0

  get MIN_ALLOWED_BOARD_SCORE() {
    return this.hyperParameters.MIN_ALLOWED_BOARD_SCORE ?? -10000
  }

  nodeMemoryPfMap: Map<CapacityMeshNodeId, number>

  // Current pathing state - using queues for easier rip/requeue
  /** Connections waiting to be routed */
  unprocessedConnectionQueue: ConnectionPathResult[] = []
  /** Connections that have been successfully routed */
  processedConnectionQueue: ConnectionPathResult[] = []
  /** The connection currently being worked on */
  currentConnection: ConnectionPathResult | null = null
  /** Total number of connections (for progress calculation) */
  totalConnectionCount = 0

  currentPathIterations = 0
  candidates?: PortPointCandidate[] | null
  /** Tracks visited port point IDs to avoid revisiting */
  visitedPortPoints?: Set<string> | null
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>

  capacityMeshNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>

  /** Heuristic scaling: an estimate of "node pitch" used to estimate remaining hops */
  avgNodePitch: number

  /** Whether the current connection should be forced to route off-board */
  currentConnectionShouldRouteOffBoard = false

  activeCandidateStraightLineDistance?: number

  /** Cached list of off-board nodes for computing distance to nearest off-board node */
  offBoardNodes: InputNodeWithPortPoints[] = []

  /** Cache of base node cost (cost of node in current committed state) */
  private baseNodeCostCache = new Map<CapacityMeshNodeId, number>()

  constructor(
    public input: {
      simpleRouteJson: SimpleRouteJson
      capacityMeshNodes: CapacityMeshNode[]
      inputNodes: InputNodeWithPortPoints[]
      colorMap?: Record<string, string>
      nodeMemoryPfMap?: Map<CapacityMeshNodeId, number>
      hyperParameters?: Partial<PortPointPathingHyperParameters>
      precomputedInitialParams?: PrecomputedInitialParams
      /** Pre-routed connections that should not be re-routed but should appear in results */
      fixedRoutes?: ConnectionPathResult[]
    },
  ) {
    super()
    const {
      simpleRouteJson,
      capacityMeshNodes,
      inputNodes,
      colorMap,
      nodeMemoryPfMap,
      hyperParameters,
      precomputedInitialParams,
      fixedRoutes,
    } = input
    this.input = structuredClone(input)
    this.MAX_ITERATIONS = 100e6
    this.simpleRouteJson = simpleRouteJson
    this.inputNodes = inputNodes
    this.colorMap = colorMap ?? {}
    this.capacityMeshNodeMap = new Map(
      capacityMeshNodes.map((n) => [n.capacityMeshNodeId, n]),
    )
    this.nodeMemoryPfMap = nodeMemoryPfMap ?? new Map()
    this.hyperParameters = hyperParameters ?? {}

    if (precomputedInitialParams) {
      // Use precomputed params - clone mutable ones
      this.nodeMap = precomputedInitialParams.nodeMap
      this.avgNodePitch = precomputedInitialParams.avgNodePitch
      this.offBoardNodes = precomputedInitialParams.offBoardNodes
      this.portPointMap = precomputedInitialParams.portPointMap
      this.nodePortPointsMap = precomputedInitialParams.nodePortPointsMap
      this.connectionNameToGoalNodeIds =
        precomputedInitialParams.connectionNameToGoalNodeIds

      // Clone mutable params
      const { nodeAssignedPortPoints } = clonePrecomputedMutableParams(
        precomputedInitialParams,
      )
      this.nodeAssignedPortPoints = nodeAssignedPortPoints

      // Shuffle the connections based on SHUFFLE_SEED
      this.connectionsWithResults = cloneAndShuffleArray(
        structuredClone(
          precomputedInitialParams.unshuffledConnectionsWithResults,
        ),
        this.hyperParameters.SHUFFLE_SEED ?? 0,
      )
    } else {
      // Compute all params from scratch
      this.nodeMap = new Map(inputNodes.map((n) => [n.capacityMeshNodeId, n]))

      // Compute a rough node pitch to convert distance into estimated hops for heuristic
      const pitches = inputNodes
        .map((n) => (n.width + n.height) / 2)
        .filter((x) => Number.isFinite(x) && x > 0)
      this.avgNodePitch =
        pitches.length > 0
          ? pitches.reduce((a, b) => a + b, 0) / pitches.length
          : 1

      // Cache off-board nodes for FORCE_OFF_BOARD routing
      this.offBoardNodes = inputNodes.filter((n) => n._offBoardConnectionId)

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

    // Add fixed routes (pre-routed connections) to the results
    // These are connections that should not be re-routed but should appear in visualization
    if (fixedRoutes && fixedRoutes.length > 0) {
      for (const fixedRoute of fixedRoutes) {
        // Add to connectionsWithResults so they appear in visualization
        this.connectionsWithResults.push(fixedRoute)

        // Mark their port points as assigned so the solver routes around them
        if (fixedRoute.portPoints) {
          for (const pp of fixedRoute.portPoints) {
            if (pp.portPointId) {
              this.assignedPortPoints.set(pp.portPointId, {
                connectionName: pp.connectionName,
                rootConnectionName: pp.rootConnectionName,
              })
            }
          }
        }
      }
    }

    // Initialize connection queues from connectionsWithResults
    // Fixed routes (with path already set) go to processed queue
    // Others go to unprocessed queue
    for (const conn of this.connectionsWithResults) {
      if (conn.path) {
        this.processedConnectionQueue.push(conn)
      } else {
        this.unprocessedConnectionQueue.push(conn)
      }
    }
    this.totalConnectionCount = this.connectionsWithResults.length
  }

  getConstructorParams() {
    return this.input
  }

  private clearCostCaches() {
    this.baseNodeCostCache.clear()
  }

  private clampPf(pf: number): number {
    if (!Number.isFinite(pf)) return 0.999999
    // pf estimator can exceed 1. Clamp to keep log stable.
    return Math.min(Math.max(pf, 0), 0.999999)
  }

  /** Convert Pf into an additive "failure cost" */
  private pfToFailureCost(pf: number): number {
    const p = this.clampPf(pf)
    if (p >= this.NODE_MAX_PF) return this.NODE_PF_MAX_PENALTY
    // -log(1-p) is 0 at p=0 and increases quickly as p->1
    return -Math.log(1 - p)
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

  computeBoardScore(): number {
    const allNodesWithPortPoints = this.getNodesWithPortPoints()
    if (this.JUMPER_PF_FN_ENABLED) {
      return computeSectionScoreWithJumpers(
        allNodesWithPortPoints,
        this.capacityMeshNodeMap,
      )
    }
    return computeSectionScore(allNodesWithPortPoints, this.capacityMeshNodeMap)
  }

  getMaxIterationsForCurrentPath() {
    const straightLineDistance = this.activeCandidateStraightLineDistance ?? 0
    return Math.min(
      this.BASE_ITERATIONS_PER_PATH +
        this.ITERATIONS_PER_MM_FOR_PATH * straightLineDistance,
      this.MAX_ITERATIONS_PER_PATH,
    )
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
    const node = this.nodeMap.get(nodeId)
    if (!node) return 0

    const baseCost = this.getBaseNodeFailureCost(nodeId)

    const pfAfter = this.computeNodePf(node, [entry, exit])
    const afterCost = this.pfToFailureCost(pfAfter)

    // If the estimator ever yields a lower Pf after adding points, don't reward it here.
    const delta = Math.max(0, afterCost - baseCost)

    if (pfAfter >= this.NODE_MAX_PF) return this.NODE_PF_MAX_PENALTY

    return delta * this.NODE_PF_FACTOR
  }

  getConnectionsWithNodes() {
    const { unshuffledConnectionsWithResults, connectionNameToGoalNodeIds } =
      getConnectionsWithNodesShared(this.simpleRouteJson, this.inputNodes)

    const connectionsWithResults = cloneAndShuffleArray(
      unshuffledConnectionsWithResults,
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
    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)

    // Use jumper-based pf calculation for single layer nodes when enabled
    if (this.JUMPER_PF_FN_ENABLED && node.availableZ.length === 1) {
      return calculateNodeProbabilityOfFailureWithJumpers(
        this.capacityMeshNodeMap.get(node.capacityMeshNodeId)!,
        crossings.numSameLayerCrossings,
      )
    }

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
   * Compute distance to the nearest off-board node from a point.
   */
  computeDistanceToNearestOffBoardNode(point: {
    x: number
    y: number
  }): number {
    if (this.offBoardNodes.length === 0) return Infinity

    let minDist = Infinity
    for (const node of this.offBoardNodes) {
      const dist = distance(point, node.center)
      if (dist < minDist) {
        minDist = dist
      }
    }
    return minDist
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
    point: InputPortPoint,
    currentNodeId: CapacityMeshNodeId,
    endGoalNodeId: CapacityMeshNodeId,
    currentZ: number,
    distanceTraveled: number,
    hasTouchedOffBoardNode?: boolean,
  ): number {
    // Random walk: if we haven't traveled far enough, return 0 to encourage exploration
    if (
      this.RANDOM_WALK_DISTANCE > 0 &&
      distanceTraveled < this.RANDOM_WALK_DISTANCE
    ) {
      return 0
    }

    // If we should force off-board routing and haven't touched an off-board node yet,
    // return distance to nearest off-board node to guide the path there
    if (this.currentConnectionShouldRouteOffBoard && !hasTouchedOffBoardNode) {
      return (
        this.BASE_COST_FOR_NOT_GOING_OFF_BOARD +
        this.computeDistanceToNearestOffBoardNode(point)
      )
    }

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

    const centerOffsetDistPenalty =
      this.CENTER_OFFSET_DIST_PENALTY_FACTOR *
      point.distToCentermostPortOnZ ** 2

    let straightLineDeviationPenalty = 0
    if (
      this.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR > 0 &&
      this.currentConnection
    ) {
      const startPoint = this.currentConnection.connection.pointsToConnect[0]
      const endPoint = this.currentConnection.connection.pointsToConnect[1]
      const deviation = pointToSegmentDistance(point, startPoint, endPoint)
      straightLineDeviationPenalty =
        this.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR * deviation
    }

    return (
      distanceToGoal +
      estStepCost +
      memRiskForHop +
      centerOffsetDistPenalty +
      straightLineDeviationPenalty
    )
  }

  getVisitedPortPointKey(
    portPointId: string,
    hasTouchedOffBoardNode?: boolean,
  ): string {
    if (this.currentConnectionShouldRouteOffBoard && hasTouchedOffBoardNode) {
      return `${portPointId}:touched_off_board`
    }
    return portPointId
  }

  getAvailableExitPortPoints(
    nodeId: CapacityMeshNodeId,
    hasTouchedOffBoardNode?: boolean,
  ) {
    const currentRootConnectionName =
      this.currentConnection?.connection.rootConnectionName
    const portPoints = this.nodePortPointsMap.get(nodeId) ?? []

    const availablePortPoints: InputPortPoint[] = []

    for (const pp of portPoints) {
      const visitedKey = this.getVisitedPortPointKey(
        pp.portPointId,
        hasTouchedOffBoardNode,
      )
      if (this.visitedPortPoints?.has(visitedKey)) continue
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
    hasTouchedOffBoardNode?: boolean,
  ): InputPortPoint[] {
    const portPoints = this.nodePortPointsMap.get(nodeId) ?? []
    // const currentNode = this.nodeMap.get(nodeId)
    const currentRootConnectionName =
      this.currentConnection?.connection.rootConnectionName

    // Group by "other side node" + z
    const portsOnSameEdgeMap = new Map<string, InputPortPoint[]>()

    for (const pp of portPoints) {
      const visitedKey = this.getVisitedPortPointKey(
        pp.portPointId,
        hasTouchedOffBoardNode,
      )
      if (this.visitedPortPoints?.has(visitedKey)) continue

      const otherNodeId = this.getOtherNodeId(pp, nodeId)
      if (!otherNodeId) continue

      const otherNode = this.nodeMap.get(otherNodeId)

      const edgeKey = `${otherNodeId}|${pp.z}`
      const arr = portsOnSameEdgeMap.get(edgeKey) ?? []
      arr.push(pp)
      portsOnSameEdgeMap.set(edgeKey, arr)
    }

    const result: InputPortPoint[] = []

    for (const [, portsOnSameEdge] of portsOnSameEdgeMap) {
      // Sort by "center offset distance" (0 first)
      portsOnSameEdge.sort(
        (a, b) => a.distToCentermostPortOnZ - b.distToCentermostPortOnZ,
      )

      const center = portsOnSameEdge[0]
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

      // Sort all ports by position to identify contiguous ranges
      const allPortsSorted = [...portsOnSameEdge].sort((a, b) => {
        if (a.x !== b.x) return a.x - b.x
        return a.y - b.y
      })

      // Find contiguous ranges of available ports (separated by occupied ports)
      const ranges: InputPortPoint[][] = []
      let currentRange: InputPortPoint[] = []

      for (const pp of allPortsSorted) {
        const assignment = this.assignedPortPoints.get(pp.portPointId)
        const isAvailable =
          !assignment ||
          assignment.rootConnectionName === currentRootConnectionName

        if (isAvailable) {
          currentRange.push(pp)
        } else {
          // Port occupied by different net - ends current range
          if (currentRange.length > 0) {
            ranges.push(currentRange)
            currentRange = []
          }
        }
      }

      // Don't forget the last range
      if (currentRange.length > 0) {
        ranges.push(currentRange)
      }

      // Return the median (centermost) of each contiguous range
      for (const range of ranges) {
        const medianIndex = Math.floor(range.length / 2)
        result.push(range[medianIndex])
      }
    }

    return result
  }

  getAvailableExitPortPointsForOffboardConnection(
    nodeId: CapacityMeshNodeId,
    hasTouchedOffBoardNode?: boolean,
  ) {
    const currentNode = this.nodeMap.get(nodeId)
    if (!currentNode) return []
    const currentRootConnectionName =
      this.currentConnection?.connection.rootConnectionName
    const availablePortPoints: (InputPortPoint & {
      throughNodeId: CapacityMeshNodeId
    })[] = []

    // If this node is connected to other nodes via off board connections, also
    // add the port points for the other nodes
    for (const otherNodeId of currentNode?._offBoardConnectedCapacityMeshNodeIds ??
      []) {
      if (otherNodeId === nodeId) continue
      const otherNode = this.nodeMap.get(otherNodeId)
      if (!otherNode) continue
      const otherPortPoints = this.nodePortPointsMap.get(otherNodeId) ?? []
      for (const pp of otherPortPoints) {
        const visitedKey = this.getVisitedPortPointKey(
          pp.portPointId,
          hasTouchedOffBoardNode,
        )
        if (this.visitedPortPoints?.has(visitedKey)) continue
        const assignment = this.assignedPortPoints.get(pp.portPointId)
        if (
          assignment &&
          assignment.rootConnectionName !== currentRootConnectionName
        )
          continue
        availablePortPoints.push({
          ...pp,
          throughNodeId: otherNodeId,
        })
      }
    }

    return availablePortPoints
  }

  canTravelThroughObstacle(
    node: InputNodeWithPortPoints,
    connectionName: string,
    rootConnectionName: string,
  ): boolean {
    const goalNodeIds = this.connectionNameToGoalNodeIds.get(connectionName)

    return (
      goalNodeIds?.includes(node.capacityMeshNodeId) ||
      Boolean(node._offBoardConnectionId)
    )
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
      // If this move was off-board, insert artificial points through the off-board nodes
      if (current.lastMoveWasOffBoard && current.throughNodeId) {
        const throughNode = this.nodeMap.get(current.throughNodeId)
        const prevNode = current.prevCandidate
          ? this.nodeMap.get(current.prevCandidate.currentNodeId)
          : null

        // Add the current candidate first
        path.push(current)

        // Add artificial point at the center of the through node (where we're going through)
        if (throughNode) {
          path.push({
            prevCandidate: null,
            portPoint: null,
            currentNodeId: current.throughNodeId,
            point: throughNode.center,
            z: current.z,
            f: 0,
            g: 0,
            h: 0,
            distanceTraveled: 0,
          })
        }

        // Add artificial point at the center of the previous off-board node (where we came from)
        if (prevNode && prevNode._offBoardConnectionId) {
          path.push({
            prevCandidate: null,
            portPoint: null,
            currentNodeId: current.prevCandidate!.currentNodeId,
            point: prevNode.center,
            z: current.z,
            f: 0,
            g: 0,
            h: 0,
            distanceTraveled: 0,
          })
        }
      } else {
        path.push(current)
      }
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

    for (let i = 0; i < path.length; i++) {
      const candidate = path[i]

      // Handle artificial center points (from off-board connections)
      // These have portPoint: null but are not start/end points
      if (!candidate.portPoint) {
        // Check if this is an artificial off-board center point (not start/end)
        const isStart = i === 0
        const isEnd = i === path.length - 1
        if (!isStart && !isEnd) {
          // This is an artificial center point for off-board connection
          const portPoint: PortPoint = {
            x: candidate.point.x,
            y: candidate.point.y,
            z: candidate.z,
            connectionName,
            rootConnectionName,
          }

          assignedPortPoints.push(portPoint)

          // Add to the node this artificial point belongs to
          const nodePortPoints =
            this.nodeAssignedPortPoints.get(candidate.currentNodeId) ?? []
          nodePortPoints.push(portPoint)
          this.nodeAssignedPortPoints.set(
            candidate.currentNodeId,
            nodePortPoints,
          )
        }
        continue
      }

      const pp = candidate.portPoint

      // Mark port point as assigned
      this.assignedPortPoints.set(pp.portPointId, {
        connectionName,
        rootConnectionName,
      })

      const portPoint: PortPoint = {
        portPointId: pp.portPointId,
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

    // Mark all nodes that are off board connected to have all their port points
    // assigned
    const nodeIdsInPath = Array.from(new Set(path.map((c) => c.currentNodeId)))
    for (const nodeId of nodeIdsInPath) {
      const node = this.nodeMap.get(nodeId)
      if (!node) continue
      if (!node._offBoardConnectionId) continue
      for (const offBoardConnectedNodeId of node?._offBoardConnectedCapacityMeshNodeIds ??
        []) {
        const portPoints =
          this.nodePortPointsMap.get(offBoardConnectedNodeId) ?? []
        for (const pp of portPoints) {
          this.assignedPortPoints.set(pp.portPointId, {
            connectionName,
            rootConnectionName,
          })
        }
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
    // If no current connection, try to get one from the unprocessed queue
    if (!this.currentConnection) {
      this.currentConnection = this.unprocessedConnectionQueue.shift() ?? null
    }

    // If still no connection, we're done
    if (!this.currentConnection) {
      const boardScore = this.computeBoardScore()
      this.stats = {
        boardScore,
      }
      if (boardScore < this.MIN_ALLOWED_BOARD_SCORE) {
        this.failedConnection = null
        this.failed = true
        this.error = `Board score ${boardScore.toFixed(2)} is less than MIN_ALLOWED_BOARD_SCORE ${this.MIN_ALLOWED_BOARD_SCORE.toFixed(2)}`
        return
      }
      this.solved = true
      return
    }

    const nextConnection = this.currentConnection

    // Set the straight line distance for dynamic iteration limit (must be before the check)
    this.activeCandidateStraightLineDistance =
      nextConnection.straightLineDistance

    // Check if we've exceeded max iterations for this path
    this.currentPathIterations++
    const maxIterationsForPath = this.getMaxIterationsForCurrentPath()
    if (this.currentPathIterations > maxIterationsForPath) {
      this.failedConnection = nextConnection
      // Move to processed queue even though it failed (to avoid infinite loops)
      this.processedConnectionQueue.push(nextConnection)
      this.currentConnection = null
      this.candidates = null
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      this.failed = true
      this.error = `Exceeded max iterations for path (${maxIterationsForPath}) on connection ${nextConnection.connection.name}`
      return
    }

    const [startNodeId, endNodeId] = nextConnection.nodeIds
    const startNode = this.nodeMap.get(startNodeId)
    const endNode = this.nodeMap.get(endNodeId)
    if (!startNode || !endNode) {
      // Invalid connection, move to processed and continue
      this.processedConnectionQueue.push(nextConnection)
      this.currentConnection = null
      this.currentPathIterations = 0
      return
    }

    const connectionName = nextConnection.connection.name
    const rootConnectionName = nextConnection.connection.rootConnectionName
    const startPoint = nextConnection.connection.pointsToConnect[0]

    if (!this.candidates) {
      // New connection search: clear caches (base costs depend on committed state)
      this.clearCostCaches()

      // Determine if this connection should route off-board based on frequency and seed
      if (this.FORCE_OFF_BOARD_FREQUENCY > 0) {
        const random = seededRandom(
          (this.hyperParameters.SHUFFLE_SEED ?? 0) * 17 +
            this.FORCE_OFF_BOARD_SEED +
            this.processedConnectionQueue.length,
        )
        this.currentConnectionShouldRouteOffBoard =
          random() < this.FORCE_OFF_BOARD_FREQUENCY
      } else {
        this.currentConnectionShouldRouteOffBoard = false
      }

      // Create initial candidates for each available z layer on the start node
      this.candidates = []
      this.visitedPortPoints = new Set<string>()

      for (const z of startNode.availableZ) {
        const p = startPoint
          ? { x: startPoint.x, y: startPoint.y }
          : startNode.center

        const h = this.computeH(
          { ...p, distToCentermostPortOnZ: 0 } as any,
          startNodeId,
          endNodeId,
          z,
          0,
          false, // hasTouchedOffBoardNode
        )
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
          distanceTraveled: 0,
          hasTouchedOffBoardNode: false,
        })
      }
    }

    // Sort candidates by f value
    this.candidates.sort((a, b) => a.f - b.f)

    // Pop until we find a candidate whose entry portPoint isn't already closed
    let currentCandidate = this.candidates.shift()
    while (currentCandidate?.portPoint && this.visitedPortPoints) {
      const visitedKey = this.getVisitedPortPointKey(
        currentCandidate.portPoint.portPointId,
        currentCandidate.hasTouchedOffBoardNode,
      )
      if (!this.visitedPortPoints.has(visitedKey)) {
        break
      }
      currentCandidate = this.candidates.shift()
    }

    // Limit memory usage
    if (this.candidates.length > this.MAX_CANDIDATES_IN_MEMORY) {
      this.candidates.splice(
        this.MAX_CANDIDATES_IN_MEMORY,
        this.candidates.length - this.MAX_CANDIDATES_IN_MEMORY,
      )
    }

    if (!currentCandidate) {
      this.error = `Ran out of candidates on connection ${connectionName}`
      this.failedConnection = nextConnection
      // Move to processed queue even though it failed
      this.processedConnectionQueue.push(nextConnection)
      this.currentConnection = null
      this.candidates = null
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      this.failed = true
      return
    }

    // Mark current port point as visited immediately
    if (currentCandidate.portPoint && this.visitedPortPoints) {
      const visitedKey = this.getVisitedPortPointKey(
        currentCandidate.portPoint.portPointId,
        currentCandidate.hasTouchedOffBoardNode,
      )
      this.visitedPortPoints.add(visitedKey)
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
        distanceTraveled:
          currentCandidate.distanceTraveled +
          distance(currentCandidate.point, finalPoint),
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

      // Process ripping if enabled
      if (this.RIPPING_ENABLED) {
        this.processRippingForPath(path, connectionName)
      }

      // Move completed connection to processed queue
      this.processedConnectionQueue.push(nextConnection)
      this.currentConnection = null
      this.progress =
        this.processedConnectionQueue.length / this.totalConnectionCount
      this.candidates = null
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      return
    }

    // Expand to available port points from current node

    let availablePortPoints: InputPortPoint[]
    const currentNode = this.nodeMap.get(currentCandidate.currentNodeId)
    if (currentNode?._offBoardConnectionId) {
      availablePortPoints =
        this.getAvailableExitPortPointsForOffboardConnection(
          currentCandidate.currentNodeId,
          currentCandidate.hasTouchedOffBoardNode,
        )
      // for (const pp of availablePortPoints) {
      //   this.visitedPortPoints?.add(pp.portPointId)
      // }
    } else if (this.FORCE_CENTER_FIRST) {
      availablePortPoints = this.getAvailableExitPortPointsWithOmissions(
        currentCandidate.currentNodeId,
        endNodeId,
        currentCandidate.hasTouchedOffBoardNode,
      )
    } else {
      availablePortPoints = this.getAvailableExitPortPoints(
        currentCandidate.currentNodeId,
        currentCandidate.hasTouchedOffBoardNode,
      )
    }

    for (const portPoint of availablePortPoints) {
      // Don't revisit port points in this path chain
      if (
        this.isPortPointInPathChain(currentCandidate, portPoint.portPointId)
      ) {
        continue
      }

      if (this.visitedPortPoints?.has(portPoint.portPointId)) continue

      // Get the node we'd enter via this port point
      const nextNodeId = this.getOtherNodeId(
        portPoint,
        (portPoint as { throughNodeId?: CapacityMeshNodeId }).throughNodeId ??
          currentCandidate.currentNodeId,
      )
      if (!nextNodeId) continue

      // HACK: Disable node cycles because stitch solver doesn't handle them
      if (this.isNodeInPathChain(currentCandidate, nextNodeId)) continue
      // if (currentCandidate.currentNodeId === nextNodeId) continue
      // if (currentCandidate.prevCandidate?.currentNodeId === nextNodeId) continue

      const throughNodeId =
        "throughNodeId" in portPoint
          ? (portPoint as { throughNodeId?: CapacityMeshNodeId }).throughNodeId
          : undefined
      const throughNode = throughNodeId ? this.nodeMap.get(throughNodeId) : null

      // // Prevent throughNodeId cycles (off-board improvement)
      // if (
      //   throughNodeId &&
      //   this.isNodeInPathChain(currentCandidate, throughNodeId)
      // ) {
      //   continue
      // }

      const nextNode = this.nodeMap.get(nextNodeId)
      if (!nextNode) continue

      // Check obstacle constraints
      if (
        nextNode._containsObstacle &&
        !this.canTravelThroughObstacle(
          nextNode,
          connectionName,
          rootConnectionName!,
        )
      ) {
        continue
      }

      const g = this.computeG(
        currentCandidate,
        portPoint,
        nextNodeId,
        connectionName,
        rootConnectionName,
      )

      // Don't add candidates whose g cost would cause the board to drop below MIN_ALLOWED_BOARD_SCORE
      if (!this.RIPPING_ENABLED && g > -this.MIN_ALLOWED_BOARD_SCORE) {
        continue
      }

      const distanceTraveled =
        currentCandidate.distanceTraveled +
        distance(currentCandidate.point, portPoint)

      // Determine if this candidate has touched an off-board node
      const hasTouchedOffBoardNode =
        currentCandidate.hasTouchedOffBoardNode ||
        Boolean(nextNode._offBoardConnectionId)

      const h = this.computeH(
        portPoint,
        nextNodeId,
        endNodeId,
        portPoint.z,
        distanceTraveled,
        hasTouchedOffBoardNode,
      )

      const f = g + h * this.GREEDY_MULTIPLIER

      const lastMoveWasOffBoard =
        Boolean(currentNode?._offBoardConnectionId) &&
        Boolean(throughNode?._offBoardConnectionId)

      this.candidates.push({
        prevCandidate: currentCandidate,
        portPoint,
        currentNodeId: nextNodeId,
        point: { x: portPoint.x, y: portPoint.y },
        z: portPoint.z,
        f,
        g,
        h,
        distanceTraveled,
        lastMoveWasOffBoard: lastMoveWasOffBoard,
        throughNodeId: lastMoveWasOffBoard ? throughNodeId : undefined,
        hasTouchedOffBoardNode:
          hasTouchedOffBoardNode ||
          Boolean(nextNode._offBoardConnectionId) ||
          Boolean(currentNode?._offBoardConnectionId),
      })
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

  /**
   * Get all connections that pass through a given node (excluding a specific connection).
   */
  getConnectionsInNode(
    nodeId: CapacityMeshNodeId,
    excludeConnectionName?: string,
  ): ConnectionPathResult[] {
    const connections: ConnectionPathResult[] = []
    const seenConnectionNames = new Set<string>()

    for (const connResult of this.connectionsWithResults) {
      if (!connResult.path) continue
      if (connResult.connection.name === excludeConnectionName) continue
      if (seenConnectionNames.has(connResult.connection.name)) continue

      // Check if this connection passes through the node
      for (const candidate of connResult.path) {
        if (candidate.currentNodeId === nodeId) {
          connections.push(connResult)
          seenConnectionNames.add(connResult.connection.name)
          break
        }
      }
    }

    return connections
  }

  /**
   * Compute the pf and crossing count of a node with a specific connection removed (for test-ripping).
   */
  computeNodePfWithoutConnection(
    node: InputNodeWithPortPoints,
    connectionNameToRemove: string,
  ): { pf: number; totalCrossings: number } {
    if (node._containsTarget) return { pf: 0, totalCrossings: 0 }

    const existingPortPoints =
      this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []

    // Filter out port points for the connection we're testing removal of
    const filteredPortPoints = existingPortPoints.filter(
      (pp) => pp.connectionName !== connectionNameToRemove,
    )

    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints: filteredPortPoints,
      availableZ: node.availableZ,
    }

    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
    const totalCrossings =
      crossings.numSameLayerCrossings +
      crossings.numEntryExitLayerChanges +
      crossings.numTransitionPairCrossings

    const pf = calculateNodeProbabilityOfFailure(
      this.capacityMeshNodeMap.get(node.capacityMeshNodeId)!,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )

    return { pf, totalCrossings }
  }

  /**
   * Compute the current crossing count for a node.
   */
  computeNodeCrossings(node: InputNodeWithPortPoints): number {
    if (node._containsTarget) return 0

    const nodeWithPortPoints = this.buildNodeWithPortPointsForCrossing(node)
    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
    return (
      crossings.numSameLayerCrossings +
      crossings.numEntryExitLayerChanges +
      crossings.numTransitionPairCrossings
    )
  }

  /**
   * Rip a connection: unassign all its port points and clear its path.
   * The connection will be re-routed later.
   */
  ripConnection(connectionResult: ConnectionPathResult): void {
    const connectionName = connectionResult.connection.name

    // Remove port points from assignedPortPoints map
    for (const [portPointId, assignment] of this.assignedPortPoints.entries()) {
      if (assignment.connectionName === connectionName) {
        this.assignedPortPoints.delete(portPointId)
      }
    }

    // Remove port points from nodeAssignedPortPoints
    for (const [nodeId, portPoints] of this.nodeAssignedPortPoints.entries()) {
      const filteredPortPoints = portPoints.filter(
        (pp) => pp.connectionName !== connectionName,
      )
      this.nodeAssignedPortPoints.set(nodeId, filteredPortPoints)
    }

    // Clear the path and portPoints so it gets re-routed
    connectionResult.path = undefined
    connectionResult.portPoints = undefined
  }

  /**
   * Requeue a connection by moving it to the unprocessed queue for re-routing.
   * If already processed, moves it from processed to unprocessed.
   * If still unprocessed, moves it to the front for priority re-routing.
   * Returns false if MAX_RIPS exceeded (solver should fail).
   */
  requeueConnection(connectionResult: ConnectionPathResult): boolean {
    this.totalRipCount++

    // Check if this connection is in the processed queue (already routed)
    const processedIndex =
      this.processedConnectionQueue.indexOf(connectionResult)
    if (processedIndex !== -1) {
      // Remove from processed queue and add to unprocessed for re-routing
      this.processedConnectionQueue.splice(processedIndex, 1)
      this.unprocessedConnectionQueue.push(connectionResult)
      return true
    }

    // Check if in unprocessed queue - move to front for priority
    const unprocessedIndex =
      this.unprocessedConnectionQueue.indexOf(connectionResult)
    if (unprocessedIndex !== -1) {
      this.unprocessedConnectionQueue.splice(unprocessedIndex, 1)
      this.unprocessedConnectionQueue.unshift(connectionResult)
    }
    return true
  }

  /**
   * Process ripping for high-pf nodes after a path is solved.
   * For each node with pf > RIPPING_PF_THRESHOLD that the path goes through,
   * test-rip connections until pf is below threshold.
   */
  processRippingForPath(
    path: PortPointCandidate[],
    justRoutedConnectionName: string,
  ): void {
    // Get unique nodes in the path
    const nodeIds = Array.from(new Set(path.map((c) => c.currentNodeId)))

    // Track whether we actually ripped any connections
    let didRipAnyConnection = false

    for (const nodeId of nodeIds) {
      // Stop if solver already failed (e.g., MAX_RIPS exceeded)
      if (this.totalRipCount > this.MAX_RIPS) break
      const node = this.nodeMap.get(nodeId)
      if (!node) continue

      // Check current pf and crossings
      let currentPf = this.computeNodePf(node)
      if (currentPf <= this.RIPPING_PF_THRESHOLD) continue

      // Initialize tested connections set for this node if needed
      if (!this.testedRipConnections.has(nodeId)) {
        this.testedRipConnections.set(nodeId, new Set())
      }
      const testedForNode = this.testedRipConnections.get(nodeId)!

      // Get connections in this node (excluding the one we just routed)
      const connectionsInNode = this.getConnectionsInNode(
        nodeId,
        justRoutedConnectionName,
      )

      // Shuffle connections pseudo-randomly for test order
      const shuffledConnections = cloneAndShuffleArray(
        connectionsInNode,
        (this.hyperParameters.SHUFFLE_SEED ?? 0) +
          this.processedConnectionQueue.length,
      )

      // Test-rip connections until pf is below threshold
      for (const connResult of shuffledConnections) {
        if (currentPf <= this.RIPPING_PF_THRESHOLD) break

        const connName = connResult.connection.name

        // Skip if we've already tested this connection for this node
        // if (testedForNode.has(connName)) continue
        testedForNode.add(connName)

        // Compute pf and crossings without this connection
        const { pf: pfWithoutConn } = this.computeNodePfWithoutConnection(
          node,
          connName,
        )

        // If pf decreases rip the connection
        this.ripConnection(connResult)
        const success = this.requeueConnection(connResult)
        if (!success) return // MAX_RIPS exceeded, solver failed
        currentPf = pfWithoutConn
        didRipAnyConnection = true

        // Clear cost caches since state changed
        this.clearCostCaches()
      }
    }

    // If we ripped any connection and RANDOM_RIP_FRACTION > 0, also rip random connections
    if (didRipAnyConnection && this.RANDOM_RIP_FRACTION > 0) {
      this.processRandomRipping(justRoutedConnectionName)
    }
  }

  /**
   * Randomly rip a fraction of already-routed connections to help escape local minima.
   * Rips (RANDOM_RIP_FRACTION * 100)% of processed connections, with a minimum of 1.
   */
  private processRandomRipping(justRoutedConnectionName: string): void {
    // Get eligible connections (processed, with paths, not the one we just routed)
    const eligibleConnections = this.processedConnectionQueue.filter(
      (conn) =>
        conn.path !== undefined &&
        conn.connection.name !== justRoutedConnectionName,
    )

    if (eligibleConnections.length === 0) return

    // Calculate how many to rip (at least 1 if RANDOM_RIP_FRACTION > 0)
    const numToRip = Math.max(
      1,
      Math.floor(this.RANDOM_RIP_FRACTION * eligibleConnections.length),
    )

    // Shuffle to pick random connections
    const shuffled = cloneAndShuffleArray(
      eligibleConnections,
      (this.hyperParameters.SHUFFLE_SEED ?? 0) +
        this.totalRipCount +
        this.processedConnectionQueue.length,
    )

    // Rip the selected number of connections
    for (let i = 0; i < numToRip && i < shuffled.length; i++) {
      if (this.totalRipCount > this.MAX_RIPS) break // Stop if MAX_RIPS exceeded

      const connResult = shuffled[i]
      this.ripConnection(connResult)
      const success = this.requeueConnection(connResult)
      if (!success) return // MAX_RIPS exceeded, solver failed

      // Clear cost caches since state changed
      this.clearCostCaches()
    }
  }

  visualize(): GraphicsObject {
    let mighbehavingfailedconnectionviz: GraphicsObject = {}
    if (this.failed) {
      // draw a line connting which two points failed to connect
      const startpoint = this.failedConnection?.connection.pointsToConnect[0]
      const endpoint = this.failedConnection?.connection.pointsToConnect[1]
      if (startpoint && endpoint) {
        mighbehavingfailedconnectionviz = {
          lines: [
            {
              points: [startpoint, endpoint],
              label: `Failed Connection ${this.failedConnection?.connection.name}`,
              strokeWidth: 1,
              strokeColor: "red",
              strokeDash: [2, 2],
            },
          ],
        }
      }
    }
    return mergeGraphics(
      visualizePointPathSolver(this),
      mighbehavingfailedconnectionviz,
    )
  }
}

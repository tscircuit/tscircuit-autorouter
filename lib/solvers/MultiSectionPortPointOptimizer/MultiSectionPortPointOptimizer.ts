import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
  SimpleRouteConnection,
} from "../../types"
import type { GraphicsObject } from "graphics-debug"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
  ConnectionPathResult,
  PortPointPathingHyperParameters,
  PortPointCandidate,
} from "../PortPointPathingSolver/PortPointPathingSolver"
import { PortPointPathingSolver } from "../PortPointPathingSolver/PortPointPathingSolver"
import { precomputeSharedParams } from "../PortPointPathingSolver/precomputeSharedParams"
import {
  createPortPointSection,
  type CreatePortPointSectionInput,
  type PortPointSection,
  type PortPointSectionParams,
  type SectionPath,
} from "./createPortPointSection"
import type {
  PortPoint,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { computeSectionScore, computeNodePf } from "./computeSectionScore"
import { visualizeSection } from "./visualizeSection"
import { findConnectionIntersectionPairs } from "./findConnectionIntersectionPairs"
import { visualizePointPathSolver } from "../PortPointPathingSolver/visualizePointPathSolver"
import { HyperPortPointPathingSolver } from "../PortPointPathingSolver/HyperPortPointPathingSolver"
import { computeSectionScoreWithJumpers } from "./computeSectionScoreWithJumpers"
import { calculateNodeProbabilityOfFailureWithJumpers } from "./calculateNodeProbabilityOfFailureWithJumpers"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

export type HyperParameterScheduleEntry = PortPointPathingHyperParameters & {
  EXPANSION_DEGREES: number
}

export interface MultiSectionPortPointOptimizerParams {
  JUMPER_PF_FN_ENABLED?: boolean
  simpleRouteJson: SimpleRouteJson
  inputNodes: InputNodeWithPortPoints[]
  capacityMeshNodes: CapacityMeshNode[]
  capacityMeshEdges: CapacityMeshEdge[]
  colorMap?: Record<string, string>
  /** Results from the initial PortPointPathingSolver run */
  initialConnectionResults: ConnectionPathResult[]
  /** Assigned port points from initial run */
  initialAssignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >
  /** Node assigned port points from initial run */
  initialNodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>
  effort?: number
  /**
   * Fraction of connections in a section to rip/replace (0-1).
   * Default 1 means rip all connections. Values less than 1 keep some traces.
   */
  FRACTION_TO_REPLACE?: number
  /**
   * If true, always rip connections that have same-layer intersections,
   * even if they would otherwise be kept due to FRACTION_TO_REPLACE.
   */
  ALWAYS_RIP_INTERSECTIONS?: boolean
  /**
   * Maximum number of attempts to fix a single node before moving on.
   * Default is 100.
   */
  MAX_ATTEMPTS_PER_NODE?: number
  /**
   * Maximum total number of section optimization attempts.
   * Default is 500.
   */
  MAX_SECTION_ATTEMPTS?: number
  /**
   * Custom hyperparameter schedule for optimization.
   * Each entry defines parameters for one optimization attempt.
   */
  HYPERPARAMETER_SCHEDULE?: HyperParameterScheduleEntry[]
}

/**
 * Simple seeded pseudo-random number generator (mulberry32)
 */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = state + 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Shuffle an array in place using a seeded random
 */
function seededShuffle<T>(array: T[], seed: number): T[] {
  const random = seededRandom(seed)
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// Generate optimization schedule with multiple shuffle seeds per expansion degree
const DEFAULT_HYPERPARAMETER_SCHEDULE: HyperParameterScheduleEntry[] = [
  {
    SHUFFLE_SEED: 100,
    NODE_PF_FACTOR: 100,
    NODE_PF_MAX_PENALTY: 100,
    MEMORY_PF_FACTOR: 0,
    EXPANSION_DEGREES: 10,
    FORCE_CENTER_FIRST: true,
    FORCE_OFF_BOARD_FREQUENCY: 0,
    CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
    // MIN_ALLOWED_BOARD_SCORE: -1,
    // MAX_ITERATIONS_PER_PATH: 300,
  },
  // {
  //   SHUFFLE_SEED: 200,
  //   NODE_PF_FACTOR: 100,
  //   MEMORY_PF_FACTOR: 0,
  //   EXPANSION_DEGREES: 4,
  //   FORCE_CENTER_FIRST: true,
  //   CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
  //   MAX_ITERATIONS_PER_PATH: 500,
  // },
  // {
  //   SHUFFLE_SEED: 300,
  //   NODE_PF_FACTOR: 100,
  //   MEMORY_PF_FACTOR: 0,
  //   EXPANSION_DEGREES: 5,
  //   FORCE_CENTER_FIRST: true,
  //   CENTER_OFFSET_DIST_PENALTY_FACTOR: 10,
  //   MAX_ITERATIONS_PER_PATH: 1600,
  // },
]

// for (let seed = 0; seed < 30; seed++) {
//   DEFAULT_HYPERPARAMETER_SCHEDULE.push({
//     SHUFFLE_SEED: seed * 100,
//     EXPANSION_DEGREES: 3,
//     CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
//   })
// }

/**
 * MultiSectionPortPointOptimizer runs local optimization on sections of the
 * port point graph. It takes the output of PortPointPathingSolver and attempts
 * to improve routing by re-running the solver on localized sections.
 *
 * This phase runs after portPointPathingSolver to refine routes in problematic areas.
 */
export class MultiSectionPortPointOptimizer extends BaseSolver {
  simpleRouteJson: SimpleRouteJson
  inputNodes: InputNodeWithPortPoints[]
  capacityMeshNodes: CapacityMeshNode[]
  capacityMeshEdges: CapacityMeshEdge[]
  colorMap: Record<string, string>

  nodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>
  capacityMeshNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>

  /** Current connection results (updated as sections are optimized) */
  connectionResults: ConnectionPathResult[]
  /** Current assigned port points */
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >
  /** Current node assigned port points */
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>

  /** Sections that have been created for optimization */
  sections: PortPointSection[] = []

  /** Section solver currently running */
  activeSubSolver: PortPointPathingSolver | null = null

  /** Current section being optimized */
  currentSection: PortPointSection | null = null

  /** Score before optimization (for comparison) */
  sectionScoreBeforeOptimization: number = 0

  /** Node ID of the center of the current section */
  currentSectionCenterNodeId: CapacityMeshNodeId | null = null

  /** Current index in the optimization schedule */
  currentScheduleIndex: number = 0

  /** Probability of failure for each node */
  nodePfMap: Map<CapacityMeshNodeId, number> = new Map()

  /** Number of attempts to fix each node */
  attemptsToFixNode: Map<CapacityMeshNodeId, number> = new Map()

  /** Total number of section optimization attempts made */
  sectionAttempts: number = 0

  /** Maximum number of attempts per node */
  MAX_ATTEMPTS_PER_NODE = 100

  /** Maximum total number of section optimization attempts */
  MAX_SECTION_ATTEMPTS = 500

  /** Acceptable probability of failure threshold */
  ACCEPTABLE_PF = 0.05

  /**
   * Fraction of connections in a section to rip/replace (0-1).
   * Default 1 means rip all connections. Values less than 1 keep some traces.
   */
  FRACTION_TO_REPLACE = 0.2

  JUMPER_PF_FN_ENABLED = false

  /**
   * If true, always rip connections that have same-layer intersections,
   * even if they would otherwise be kept due to FRACTION_TO_REPLACE.
   *
   * Uses a greedy vertex cover approach: for each intersection, only one
   * connection is ripped (chosen based on the shuffle seed), rather than
   * ripping all connections involved in intersections.
   */
  ALWAYS_RIP_INTERSECTIONS = true

  effort: number = 1

  /** Hyperparameter schedule for optimization attempts */
  HYPERPARAMETER_SCHEDULE: HyperParameterScheduleEntry[] =
    DEFAULT_HYPERPARAMETER_SCHEDULE

  constructor(params: MultiSectionPortPointOptimizerParams) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.simpleRouteJson = params.simpleRouteJson
    this.inputNodes = params.inputNodes
    this.capacityMeshNodes = params.capacityMeshNodes
    this.capacityMeshEdges = params.capacityMeshEdges
    this.colorMap = params.colorMap ?? {}
    this.effort = params.effort ?? 1
    if (params.FRACTION_TO_REPLACE !== undefined) {
      this.FRACTION_TO_REPLACE = params.FRACTION_TO_REPLACE
    }
    if (params.ALWAYS_RIP_INTERSECTIONS !== undefined) {
      this.ALWAYS_RIP_INTERSECTIONS = params.ALWAYS_RIP_INTERSECTIONS
    }
    if (params.MAX_ATTEMPTS_PER_NODE !== undefined) {
      this.MAX_ATTEMPTS_PER_NODE = params.MAX_ATTEMPTS_PER_NODE
    }
    if (params.MAX_SECTION_ATTEMPTS !== undefined) {
      this.MAX_SECTION_ATTEMPTS = params.MAX_SECTION_ATTEMPTS
    }
    if (params.HYPERPARAMETER_SCHEDULE !== undefined) {
      this.HYPERPARAMETER_SCHEDULE = params.HYPERPARAMETER_SCHEDULE
    }
    this.JUMPER_PF_FN_ENABLED =
      params.JUMPER_PF_FN_ENABLED ?? this.JUMPER_PF_FN_ENABLED

    this.MAX_SECTION_ATTEMPTS *= this.effort

    this.nodeMap = new Map(
      params.inputNodes.map((n) => [n.capacityMeshNodeId, n]),
    )
    this.capacityMeshNodeMap = new Map(
      params.capacityMeshNodes.map((n) => [n.capacityMeshNodeId, n]),
    )

    // Copy initial results
    this.connectionResults = [...params.initialConnectionResults]
    this.assignedPortPoints = new Map(params.initialAssignedPortPoints)
    this.nodeAssignedPortPoints = new Map(params.initialNodeAssignedPortPoints)

    // Initialize Pf map
    this.nodePfMap = this.computeInitialPfMap()

    // Compute initial board score
    const initialBoardScore = this.computeBoardScore()

    // Initialize stats
    this.stats.successfulOptimizations = 0
    this.stats.failedOptimizations = 0
    this.stats.nodesExamined = 0
    this.stats.sectionAttempts = 0
    this.stats.sectionScores = {} as Record<string, number>
    this.stats.initialBoardScore = initialBoardScore
    this.stats.currentBoardScore = initialBoardScore
    this.stats.errors = 0
  }

  /**
   * Compute initial Pf map for all nodes
   */
  computeInitialPfMap(): Map<CapacityMeshNodeId, number> {
    const pfMap = new Map<CapacityMeshNodeId, number>()

    for (const node of this.capacityMeshNodes) {
      const portPoints =
        this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []
      if (portPoints.length === 0) continue

      const nodeWithPortPoints: NodeWithPortPoints = {
        capacityMeshNodeId: node.capacityMeshNodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPoints,
        availableZ: node.availableZ,
      }

      // Use jumper-based pf calculation for single layer nodes when enabled
      const pf =
        this.JUMPER_PF_FN_ENABLED && node.availableZ.length === 1
          ? calculateNodeProbabilityOfFailureWithJumpers(
              node,
              getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
                .numSameLayerCrossings,
            )
          : computeNodePf(nodeWithPortPoints, node)
      pfMap.set(node.capacityMeshNodeId, pf)
    }

    return pfMap
  }

  /**
   * Compute the score for the ENTIRE board (all nodes with port points).
   */
  computeBoardScore(): number {
    const allNodesWithPortPoints = this.getNodesWithPortPoints()
    return this.computeScoreForNodes(allNodesWithPortPoints)
  }

  /**
   * Compute score for a set of nodes, using the appropriate scoring function
   * based on JUMPER_PF_FN_ENABLED.
   */
  computeScoreForNodes(nodesWithPortPoints: NodeWithPortPoints[]): number {
    if (this.JUMPER_PF_FN_ENABLED) {
      return computeSectionScoreWithJumpers(
        nodesWithPortPoints,
        this.capacityMeshNodeMap,
      )
    }
    return computeSectionScore(nodesWithPortPoints, this.capacityMeshNodeMap)
  }

  /**
   * Recompute Pf for nodes in a section
   */
  recomputePfForNodes(nodeIds: Set<CapacityMeshNodeId>) {
    for (const nodeId of nodeIds) {
      const node = this.capacityMeshNodeMap.get(nodeId)
      if (!node) continue

      const portPoints = this.nodeAssignedPortPoints.get(nodeId) ?? []
      if (portPoints.length === 0) {
        this.nodePfMap.set(nodeId, 0)
        continue
      }

      const nodeWithPortPoints: NodeWithPortPoints = {
        capacityMeshNodeId: nodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPoints,
        availableZ: node.availableZ,
      }

      // Use jumper-based pf calculation for single layer nodes when enabled
      const pf =
        this.JUMPER_PF_FN_ENABLED && node.availableZ.length === 1
          ? calculateNodeProbabilityOfFailureWithJumpers(
              node,
              getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
                .numSameLayerCrossings,
            )
          : computeNodePf(nodeWithPortPoints, node)
      this.nodePfMap.set(nodeId, pf)
    }
  }

  /**
   * Create input for createPortPointSection from current state
   */
  getCreatePortPointSectionInput(): CreatePortPointSectionInput {
    return {
      inputNodes: this.inputNodes,
      capacityMeshNodes: this.capacityMeshNodes,
      capacityMeshEdges: this.capacityMeshEdges,
      nodeMap: this.nodeMap,
      connectionResults: this.connectionResults,
    }
  }

  /**
   * Create a section for optimization
   */
  createSection(params: PortPointSectionParams): PortPointSection {
    const input = this.getCreatePortPointSectionInput()
    return createPortPointSection(input, params)
  }

  /**
   * Get nodes with port points for a section (for scoring)
   */
  getSectionNodesWithPortPoints(
    section: PortPointSection,
  ): NodeWithPortPoints[] {
    const result: NodeWithPortPoints[] = []

    for (const nodeId of section.nodeIds) {
      const inputNode = this.nodeMap.get(nodeId)
      const capacityNode = this.capacityMeshNodeMap.get(nodeId)
      if (!inputNode || !capacityNode) continue

      const portPoints = this.nodeAssignedPortPoints.get(nodeId) ?? []
      if (portPoints.length > 0) {
        result.push({
          capacityMeshNodeId: nodeId,
          center: inputNode.center,
          width: inputNode.width,
          height: inputNode.height,
          portPoints,
          availableZ: inputNode.availableZ,
        })
      }
    }

    return result
  }

  /**
   * Get nodes with port points for the section (for HighDensitySolver)
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
   * Find the node with the highest probability of failure
   */
  findHighestPfNode(): CapacityMeshNodeId | null {
    let highestPfNodeId: CapacityMeshNodeId | null = null
    let highestPf = 0

    for (const [nodeId, pf] of this.nodePfMap.entries()) {
      // Reduce effective Pf based on number of attempts
      const attempts = this.attemptsToFixNode.get(nodeId) ?? 0
      const pfReduced = pf * (1 - attempts / this.MAX_ATTEMPTS_PER_NODE) ** 2

      if (pfReduced > highestPf) {
        highestPf = pf
        highestPfNodeId = nodeId
      }
    }

    if (!highestPfNodeId || highestPf < this.ACCEPTABLE_PF) {
      return null
    }

    return highestPfNodeId
  }

  /** Cut path info for tracking during reattachment */
  currentSectionCutPathInfo: Map<
    string,
    {
      sectionPath: SectionPath
      originalConnectionResult: ConnectionPathResult
    }
  > = new Map()

  /** Port points from connections that are being kept (not ripped) in the current section */
  currentSectionKeptPortPoints: Map<CapacityMeshNodeId, PortPoint[]> = new Map()

  /** Connection results for connections being kept (not ripped) - used for visualization */
  currentSectionFixedRoutes: ConnectionPathResult[] = []

  /**
   * Determine which connections to rip based on FRACTION_TO_REPLACE and ALWAYS_RIP_INTERSECTIONS.
   * Returns a set of connection names that should be ripped (re-routed).
   */
  determineConnectionsToRip(
    section: PortPointSection,
    allConnectionNames: string[],
  ): Set<string> {
    // Seed based on section attempt count for deterministic but varying selection
    const seed = this.sectionAttempts * 31337
    const random = seededRandom(seed)

    // If FRACTION_TO_REPLACE is 1, rip all connections
    if (this.FRACTION_TO_REPLACE >= 1) {
      return new Set(allConnectionNames)
    }

    // Shuffle connections deterministically
    const shuffled = seededShuffle(allConnectionNames, seed)

    // Select fraction to rip
    const ripCount = Math.max(
      1,
      Math.ceil(shuffled.length * this.FRACTION_TO_REPLACE),
    )
    const connectionsToRip = new Set(shuffled.slice(0, ripCount))

    // If ALWAYS_RIP_INTERSECTIONS is true, use greedy vertex cover approach:
    // For each intersection pair, pick ONE connection to rip (not both)
    if (this.ALWAYS_RIP_INTERSECTIONS) {
      const intersectionPairs = findConnectionIntersectionPairs({
        section,
        nodePfMap: this.nodePfMap,
        capacityMeshNodeMap: this.capacityMeshNodeMap,
        nodeAssignedPortPoints: this.nodeAssignedPortPoints,
        acceptablePf: this.ACCEPTABLE_PF,
      })

      // Greedy vertex cover: for each uncovered intersection, pick one connection to rip
      // The choice is deterministic based on the shuffle seed
      for (const [conn1, conn2] of intersectionPairs) {
        // Skip if this intersection is already covered (one of the connections will be ripped)
        if (connectionsToRip.has(conn1) || connectionsToRip.has(conn2)) {
          continue
        }

        // Both connections are in section - pick one based on seed
        const conn1InSection = allConnectionNames.includes(conn1)
        const conn2InSection = allConnectionNames.includes(conn2)

        if (conn1InSection && conn2InSection) {
          // Pick one randomly using the seeded random
          const pickFirst = random() < 0.5
          connectionsToRip.add(pickFirst ? conn1 : conn2)
        } else if (conn1InSection) {
          connectionsToRip.add(conn1)
        } else if (conn2InSection) {
          connectionsToRip.add(conn2)
        }
      }
    }
    this.stats.lastRipCount = connectionsToRip.size

    return connectionsToRip
  }

  /**
   * Create a SimpleRouteJson for just the section's connections.
   * Includes both fully contained connections AND cut paths (partial connections
   * that pass through the section).
   *
   * Respects FRACTION_TO_REPLACE and ALWAYS_RIP_INTERSECTIONS to determine which
   * connections to include for re-routing.
   */
  createSectionSimpleRouteJson(section: PortPointSection): SimpleRouteJson {
    const connections: SimpleRouteConnection[] = []
    this.currentSectionCutPathInfo.clear()
    this.currentSectionKeptPortPoints.clear()
    this.currentSectionFixedRoutes = []

    // First, collect all connection names in this section
    const allConnectionNames: string[] = []

    // Fully contained connections
    const fullyContainedResults: ConnectionPathResult[] = []
    for (const result of this.connectionResults) {
      if (!result.path || result.path.length === 0) continue

      const [startNodeId, endNodeId] = result.nodeIds

      // Check if both start and end nodes are in the section
      const startInSection = section.nodeIds.has(startNodeId)
      const endInSection = section.nodeIds.has(endNodeId)

      if (startInSection && endInSection) {
        fullyContainedResults.push(result)
        allConnectionNames.push(result.connection.name)
      }
    }

    // Cut path connections
    const cutPathCandidates: Array<{
      sectionPath: SectionPath
      originalResult: ConnectionPathResult
    }> = []
    for (const sectionPath of section.sectionPaths) {
      // Skip paths that are fully contained
      if (!sectionPath.hasEntryFromOutside && !sectionPath.hasExitToOutside) {
        continue
      }

      // Skip very short cut paths (less than 2 points)
      if (sectionPath.points.length < 2) {
        continue
      }

      // Find the original connection result for this path
      const originalResult = this.connectionResults.find(
        (r) => r.connection.name === sectionPath.connectionName,
      )
      if (!originalResult) continue

      cutPathCandidates.push({ sectionPath, originalResult })
      // Add the original connection name (not the cut name)
      if (!allConnectionNames.includes(sectionPath.connectionName)) {
        allConnectionNames.push(sectionPath.connectionName)
      }
    }

    // Determine which connections to rip
    const connectionsToRip = this.determineConnectionsToRip(
      section,
      allConnectionNames,
    )

    // Add fully contained connections that should be ripped
    for (const result of fullyContainedResults) {
      if (connectionsToRip.has(result.connection.name)) {
        connections.push(result.connection)
      }
    }

    // Add cut paths for connections that should be ripped
    for (const { sectionPath, originalResult } of cutPathCandidates) {
      if (!connectionsToRip.has(sectionPath.connectionName)) {
        continue
      }

      // Create synthetic connection for this cut path
      const cutConnectionName = `__cut__${sectionPath.connectionName}__${sectionPath.originalStartIndex}`
      this.colorMap[cutConnectionName] =
        this.colorMap[sectionPath.connectionName]
      const startPoint = sectionPath.points[0]
      const endPoint = sectionPath.points[sectionPath.points.length - 1]

      const syntheticConnection: SimpleRouteConnection = {
        name: cutConnectionName,
        rootConnectionName:
          sectionPath.rootConnectionName ?? sectionPath.connectionName,
        pointsToConnect: [
          {
            x: startPoint.x,
            y: startPoint.y,
            layers: [`layer${startPoint.z + 1}`],
          },
          {
            x: endPoint.x,
            y: endPoint.y,
            layers: [`layer${endPoint.z + 1}`],
          },
        ],
      }

      connections.push(syntheticConnection)

      // Track the cut path info for reattachment
      this.currentSectionCutPathInfo.set(cutConnectionName, {
        sectionPath,
        originalConnectionResult: originalResult,
      })
    }

    // Collect port points from connections that are being KEPT (not ripped)
    // These need to be passed to the solver so it knows they're occupied
    const keptConnectionNames = new Set(
      allConnectionNames.filter((name) => !connectionsToRip.has(name)),
    )

    if (keptConnectionNames.size > 0) {
      for (const nodeId of section.nodeIds) {
        const nodePortPoints = this.nodeAssignedPortPoints.get(nodeId) ?? []
        const keptPortPoints = nodePortPoints.filter((pp) =>
          keptConnectionNames.has(pp.connectionName),
        )
        if (keptPortPoints.length > 0) {
          this.currentSectionKeptPortPoints.set(nodeId, keptPortPoints)
        }
      }

      // Add kept fully-contained connections to fixedRoutes for visualization
      for (const result of fullyContainedResults) {
        if (keptConnectionNames.has(result.connection.name)) {
          this.currentSectionFixedRoutes.push(result)
        }
      }

      // Add kept cut path connections to fixedRoutes
      // We need to create a synthetic result for the portion within the section
      for (const { sectionPath, originalResult } of cutPathCandidates) {
        if (keptConnectionNames.has(sectionPath.connectionName)) {
          // Create a synthetic connection result for visualization
          // The path needs point.x, point.y, z, and currentNodeId for the visualizer
          const syntheticResult: ConnectionPathResult = {
            connection: {
              name: sectionPath.connectionName,
              rootConnectionName: sectionPath.rootConnectionName,
              pointsToConnect: originalResult.connection.pointsToConnect,
            },
            path: sectionPath.points.map((p) => ({
              prevCandidate: null,
              portPoint: null,
              currentNodeId: p.nodeId,
              point: { x: p.x, y: p.y },
              z: p.z,
              f: 0,
              g: 0,
              h: 0,
              distanceTraveled: 0,
            })) as PortPointCandidate[],
            portPoints: sectionPath.points.map((p) => ({
              portPointId: p.portPointId,
              x: p.x,
              y: p.y,
              z: p.z,
              connectionName: sectionPath.connectionName,
              rootConnectionName: sectionPath.rootConnectionName,
            })),
            nodeIds: originalResult.nodeIds,
            straightLineDistance: originalResult.straightLineDistance,
          }
          this.currentSectionFixedRoutes.push(syntheticResult)
        }
      }
    }

    return {
      ...this.simpleRouteJson,
      connections,
    }
  }

  /**
   * Prepare section input nodes for routing cut paths.
   * Marks nodes containing cut path endpoints as targets so the solver can route to/from them.
   */
  prepareSectionInputNodesForCutPaths(
    section: PortPointSection,
  ): InputNodeWithPortPoints[] {
    // Create a set of node IDs that contain cut path endpoints
    const cutPathEndpointNodeIds = new Set<CapacityMeshNodeId>()

    for (const [, cutInfo] of this.currentSectionCutPathInfo.entries()) {
      const { sectionPath } = cutInfo
      if (sectionPath.points.length === 0) continue

      // Entry point node
      const entryNodeId = sectionPath.points[0].nodeId
      cutPathEndpointNodeIds.add(entryNodeId)

      // Exit point node
      const exitNodeId =
        sectionPath.points[sectionPath.points.length - 1].nodeId
      cutPathEndpointNodeIds.add(exitNodeId)
    }

    // Update input nodes to mark cut path endpoint nodes as targets
    return section.inputNodes.map((node) => {
      if (cutPathEndpointNodeIds.has(node.capacityMeshNodeId)) {
        return {
          ...node,
          _containsTarget: true,
        }
      }
      return node
    })
  }

  getHyperParametersForScheduleIndex(
    scheduleIndex: number,
    sectionAttempt: number,
  ): PortPointPathingHyperParameters {
    const scheduleParams = this.HYPERPARAMETER_SCHEDULE[scheduleIndex]
    return {
      ...scheduleParams,
      // Use the schedule's seed plus an offset based on section attempt
      // This ensures different sections try different variations
      SHUFFLE_SEED: (scheduleParams.SHUFFLE_SEED ?? 0) + sectionAttempt * 17,
    }
  }

  /**
   * Create a PortPointPathingSolver for the current section.
   * This centralizes the solver creation logic that was previously duplicated in 3 places.
   */
  createSectionSolver(section: PortPointSection): PortPointPathingSolver {
    const sectionSrj = this.createSectionSimpleRouteJson(section)
    const preparedInputNodes = this.prepareSectionInputNodesForCutPaths(section)

    // Precompute shared params and add kept port points
    const precomputedParams = precomputeSharedParams(
      sectionSrj,
      preparedInputNodes,
    )

    // Add kept port points (from connections not being ripped) to the precomputed params
    // This ensures the solver knows these port points are occupied
    for (const [nodeId, keptPortPoints] of this.currentSectionKeptPortPoints) {
      const existing =
        precomputedParams.nodeAssignedPortPoints.get(nodeId) ?? []
      precomputedParams.nodeAssignedPortPoints.set(nodeId, [
        ...existing,
        ...keptPortPoints,
      ])
    }

    return new HyperPortPointPathingSolver({
      simpleRouteJson: sectionSrj,
      inputNodes: preparedInputNodes,
      capacityMeshNodes: section.capacityMeshNodes,
      colorMap: this.colorMap,
      nodeMemoryPfMap: this.nodePfMap,
      numShuffleSeeds: sectionSrj.connections.length * 2 * this.effort,
      hyperParameters: {
        ...this.getHyperParametersForScheduleIndex(
          this.currentScheduleIndex,
          this.sectionAttempts,
        ),
      },
      precomputedInitialParams: precomputedParams,
      fixedRoutes: this.currentSectionFixedRoutes,
    }) as unknown as PortPointPathingSolver
  }

  /**
   * Reattach the optimized section results back to the main state.
   * Handles both fully contained connections AND cut paths.
   */
  reattachSection(
    _section: PortPointSection,
    newConnectionResults: ConnectionPathResult[],
    newAssignedPortPoints: Map<
      string,
      { connectionName: string; rootConnectionName?: string }
    >,
    newNodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>,
  ) {
    // Separate fully contained connections from cut paths
    const fullyContainedResults: ConnectionPathResult[] = []
    const cutPathResults: ConnectionPathResult[] = []

    for (const result of newConnectionResults) {
      if (result.connection.name.startsWith("__cut__")) {
        cutPathResults.push(result)
      } else {
        fullyContainedResults.push(result)
      }
    }

    // Handle fully contained connections (replace entirely)
    const reRoutedConnectionNames = new Set(
      fullyContainedResults.map((r) => r.connection.name),
    )

    // Remove old results for fully contained connections
    this.connectionResults = this.connectionResults.filter(
      (r) => !reRoutedConnectionNames.has(r.connection.name),
    )

    // Add new results for fully contained connections
    this.connectionResults.push(...fullyContainedResults)

    // Clear port points for fully re-routed connections from all nodes
    for (const [nodeId, portPoints] of this.nodeAssignedPortPoints.entries()) {
      const remainingPortPoints = portPoints.filter(
        (pp) => !reRoutedConnectionNames.has(pp.connectionName),
      )
      this.nodeAssignedPortPoints.set(nodeId, remainingPortPoints)
    }

    // Remove old assigned port points for fully re-routed connections
    for (const [portPointId, info] of this.assignedPortPoints.entries()) {
      if (reRoutedConnectionNames.has(info.connectionName)) {
        this.assignedPortPoints.delete(portPointId)
      }
    }

    // Handle cut paths (splice back into original paths)
    for (const cutResult of cutPathResults) {
      const cutInfo = this.currentSectionCutPathInfo.get(
        cutResult.connection.name,
      )
      if (!cutInfo || !cutResult.path) continue

      const { sectionPath, originalConnectionResult } = cutInfo
      const originalPath = originalConnectionResult.path
      if (!originalPath) continue

      // Get the original connection name (without the __cut__ prefix)
      const originalConnectionName = sectionPath.connectionName

      // Clear old port points for the portion being replaced
      // We need to remove port points that were in the original cut section
      for (const [
        nodeId,
        portPoints,
      ] of this.nodeAssignedPortPoints.entries()) {
        const filtered = portPoints.filter((pp) => {
          if (pp.connectionName !== originalConnectionName) return true
          // Keep port points outside the section (we only remove the cut portion)
          return !_section.nodeIds.has(nodeId)
        })
        this.nodeAssignedPortPoints.set(nodeId, filtered)
      }

      // Build the new path by splicing in the rerouted portion
      // Original path: [...before cut...][cut portion][...after cut...]
      // New path: [...before cut...][new rerouted portion][...after cut...]
      const beforeCut = originalPath.slice(0, sectionPath.originalStartIndex)
      const afterCut = originalPath.slice(sectionPath.originalEndIndex + 1)

      // Convert the new result path to match PortPointCandidate format
      // We need to update connectionName in the path and link prevCandidate correctly
      const newMiddlePath: PortPointCandidate[] = []
      let prevCandidate: PortPointCandidate | null =
        beforeCut.length > 0 ? beforeCut[beforeCut.length - 1] : null

      for (const candidate of cutResult.path) {
        const newCandidate: PortPointCandidate = {
          ...candidate,
          prevCandidate,
        }
        newMiddlePath.push(newCandidate)
        prevCandidate = newCandidate
      }

      // Link afterCut to the last of the new middle path
      if (afterCut.length > 0 && newMiddlePath.length > 0) {
        afterCut[0] = {
          ...afterCut[0],
          prevCandidate: newMiddlePath[newMiddlePath.length - 1],
        }
      }

      // Update the original connection result with the spliced path
      originalConnectionResult.path = [
        ...beforeCut,
        ...newMiddlePath,
        ...afterCut,
      ]

      // Add port points from the new route to the nodes
      if (cutResult.portPoints) {
        for (const pp of cutResult.portPoints) {
          // Update connectionName to original (not the __cut__ name)
          const correctedPortPoint: PortPoint = {
            ...pp,
            connectionName: originalConnectionName,
            rootConnectionName:
              sectionPath.rootConnectionName ?? originalConnectionName,
          }

          // Find which nodes this port point belongs to and add it
          for (const node of _section.inputNodes) {
            for (const inputPp of node.portPoints) {
              if (
                Math.abs(inputPp.x - pp.x) < 0.001 &&
                Math.abs(inputPp.y - pp.y) < 0.001 &&
                inputPp.z === pp.z
              ) {
                for (const nodeId of inputPp.connectionNodeIds) {
                  const existing = this.nodeAssignedPortPoints.get(nodeId) ?? []
                  existing.push(correctedPortPoint)
                  this.nodeAssignedPortPoints.set(nodeId, existing)
                }
                break
              }
            }
          }
        }
      }
    }

    // Add new assigned port points for fully contained (but not for cut paths
    // since we handled them above with corrected names)
    for (const [portPointId, info] of newAssignedPortPoints.entries()) {
      if (!info.connectionName.startsWith("__cut__")) {
        this.assignedPortPoints.set(portPointId, info)
      }
    }

    // Add new node assigned port points for fully contained connections
    for (const [nodeId, portPoints] of newNodeAssignedPortPoints.entries()) {
      const filteredPortPoints = portPoints.filter(
        (pp) => !pp.connectionName.startsWith("__cut__"),
      )
      if (filteredPortPoints.length > 0) {
        const existing = this.nodeAssignedPortPoints.get(nodeId) ?? []
        this.nodeAssignedPortPoints.set(nodeId, [
          ...existing,
          ...filteredPortPoints,
        ])
      }
    }
  }

  _step() {
    if (this.activeSubSolver) {
      // Step the active sub-solver
      this.activeSubSolver.step()

      if (this.activeSubSolver.solved || this.activeSubSolver.failed) {
        if (this.activeSubSolver.failed) {
          // Sub-solver failed, try next schedule params or move on
          this.currentScheduleIndex++
          if (this.activeSubSolver.error) {
            this.stats.errors++
          }

          if (
            this.currentScheduleIndex < this.HYPERPARAMETER_SCHEDULE.length &&
            this.currentSectionCenterNodeId
          ) {
            // Try next schedule params
            const params =
              this.HYPERPARAMETER_SCHEDULE[this.currentScheduleIndex]

            this.currentSection = this.createSection({
              centerOfSectionCapacityNodeId: this.currentSectionCenterNodeId,
              expansionDegrees: params.EXPANSION_DEGREES,
            })

            this.activeSubSolver = this.createSectionSolver(this.currentSection)
          } else {
            // All schedule params exhausted, move on
            this.stats.failedOptimizations++
            this.activeSubSolver = null
            this.currentSection = null
            this.currentSectionCenterNodeId = null
            this.currentScheduleIndex = 0
          }
          return
        }

        // Sub-solver succeeded - compute new section score (for quick comparison)
        // Map __cut__ port points back to original connection names to make comparison fair
        // with "before" score. The __cut__ prefix format is: __cut__<originalName>__<startIndex>
        const newNodesWithPortPoints = this.activeSubSolver
          .getNodesWithPortPoints()
          .map((node) => ({
            ...node,
            portPoints: node.portPoints.map((pp) => {
              if (pp.connectionName.startsWith("__cut__")) {
                // Extract original connection name from __cut__<name>__<index>
                const withoutPrefix = pp.connectionName.slice("__cut__".length)
                const lastUnderscoreIdx = withoutPrefix.lastIndexOf("__")
                const originalName =
                  lastUnderscoreIdx >= 0
                    ? withoutPrefix.slice(0, lastUnderscoreIdx)
                    : withoutPrefix
                return { ...pp, connectionName: originalName }
              }
              return pp
            }),
          }))

        // Get connection names that were re-routed by the sub-solver
        const reroutedConnNames = new Set<string>()
        for (const node of newNodesWithPortPoints) {
          for (const pp of node.portPoints) {
            reroutedConnNames.add(pp.connectionName)
          }
        }

        // Filter "before" nodes to only include port points from re-routed connections
        // This ensures we're comparing apples to apples
        const beforeNodes = this.getSectionNodesWithPortPoints(
          this.currentSection!,
        )
        const filteredBeforeNodes = beforeNodes
          .map((node) => ({
            ...node,
            portPoints: node.portPoints.filter((pp) =>
              reroutedConnNames.has(pp.connectionName),
            ),
          }))
          .filter((node) => node.portPoints.length > 0)

        const filteredBeforeScore =
          this.computeScoreForNodes(filteredBeforeNodes)
        const newSectionScore = this.computeScoreForNodes(
          newNodesWithPortPoints,
        )

        const attemptKey = `attempt${this.sectionAttempts}`
        this.stats.lastSectionScore = newSectionScore

        // Compare section scores first (higher is better)
        // Use filteredBeforeScore to compare only connections that were re-routed
        if (newSectionScore > filteredBeforeScore) {
          // Section score improved - tentatively apply and check board score
          const previousBoardScore = this.stats.currentBoardScore as number
          this.stats.lastBoardScore = previousBoardScore

          // Save state before applying changes (for potential revert)
          const savedConnectionResults = [...this.connectionResults]
          const savedAssignedPortPoints = new Map(this.assignedPortPoints)
          const savedNodeAssignedPortPoints = new Map(
            Array.from(this.nodeAssignedPortPoints.entries()).map(
              ([k, v]) => [k, [...v]] as [string, PortPoint[]],
            ),
          )

          // Apply the section changes
          this.reattachSection(
            this.currentSection!,
            this.activeSubSolver.connectionsWithResults,
            this.activeSubSolver.assignedPortPoints,
            this.activeSubSolver.nodeAssignedPortPoints,
          )

          // Recompute Pf for affected nodes
          this.recomputePfForNodes(this.currentSection!.nodeIds)

          // Compute the new board score AFTER applying the section
          const newBoardScore = this.computeBoardScore()

          // Record the board score after this attempt
          ;(this.stats.sectionScores as Record<string, number>)[attemptKey] =
            newBoardScore

          // Only count as successful if the BOARD score actually improved (higher is better)
          if (newBoardScore > previousBoardScore) {
            this.stats.successfulOptimizations++
            this.stats.currentBoardScore = newBoardScore
          } else {
            // Board score didn't improve - revert the changes
            this.connectionResults = savedConnectionResults
            this.assignedPortPoints = savedAssignedPortPoints
            this.nodeAssignedPortPoints = savedNodeAssignedPortPoints
            this.recomputePfForNodes(this.currentSection!.nodeIds)
            this.stats.failedOptimizations++
          }

          // Reset and move on
          this.activeSubSolver = null
          this.currentSection = null
          this.currentSectionCenterNodeId = null
          this.currentScheduleIndex = 0
        } else {
          // No improvement, try next schedule params
          this.currentScheduleIndex++

          if (
            this.currentScheduleIndex < this.HYPERPARAMETER_SCHEDULE.length &&
            this.currentSectionCenterNodeId
          ) {
            // Try next schedule params
            const params =
              this.HYPERPARAMETER_SCHEDULE[this.currentScheduleIndex]
            this.currentSection = this.createSection({
              centerOfSectionCapacityNodeId: this.currentSectionCenterNodeId,
              expansionDegrees: params.EXPANSION_DEGREES,
            })

            this.activeSubSolver = this.createSectionSolver(this.currentSection)
          } else {
            // All schedule params exhausted without improvement
            this.stats.failedOptimizations++
            this.activeSubSolver = null
            this.currentSection = null
            this.currentSectionCenterNodeId = null
            this.currentScheduleIndex = 0
          }
        }
      }
      return
    }

    // No active sub-solver - find highest Pf node and start new optimization

    // Check if we've exceeded the maximum number of section attempts
    if (this.sectionAttempts >= this.MAX_SECTION_ATTEMPTS) {
      this.solved = true
      return
    }

    const highestPfNodeId = this.findHighestPfNode()

    if (!highestPfNodeId) {
      // No nodes need optimization
      this.solved = true
      return
    }

    this.sectionAttempts++
    this.stats.sectionAttempts = this.sectionAttempts
    this.stats.nodesExamined++

    // Increment attempt counter
    this.attemptsToFixNode.set(
      highestPfNodeId,
      (this.attemptsToFixNode.get(highestPfNodeId) ?? 0) + 1,
    )

    // Create section centered on highest Pf node
    this.currentSectionCenterNodeId = highestPfNodeId
    this.currentScheduleIndex = 0
    const params = this.HYPERPARAMETER_SCHEDULE[this.currentScheduleIndex]

    this.currentSection = this.createSection({
      centerOfSectionCapacityNodeId: highestPfNodeId,
      expansionDegrees: params.EXPANSION_DEGREES,
    })

    // Compute score before optimization
    const sectionNodesWithPortPoints = this.getSectionNodesWithPortPoints(
      this.currentSection,
    )
    this.sectionScoreBeforeOptimization = this.computeScoreForNodes(
      sectionNodesWithPortPoints,
    )

    // Check if section has connections to optimize (create temp SimpleRouteJson to check)
    const sectionSrj = this.createSectionSimpleRouteJson(this.currentSection)
    if (sectionSrj.connections.length === 0) {
      this.currentSection = null
      this.currentSectionCenterNodeId = null
      return
    }

    // Create and start PortPointPathingSolver for this section
    this.activeSubSolver = this.createSectionSolver(this.currentSection)
  }

  visualize(): GraphicsObject {
    if (this.solved) {
      return visualizePointPathSolver(this)
    }
    // If we have an active sub-solver, delegate to it
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    // If we have a current section, visualize it
    if (this.currentSection) {
      return visualizeSection(this.currentSection, this.colorMap)
    }

    // Use the shared visualizer
    return visualizePointPathSolver(this)
  }
}

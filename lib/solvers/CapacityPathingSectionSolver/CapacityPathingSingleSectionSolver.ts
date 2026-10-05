import { GraphicsObject } from "graphics-debug"
import {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { visualizeSection } from "./visualizeSection"
import { getNodeEdgeMap } from "../CapacityMeshSolver/getNodeEdgeMap" // Added import
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1" // Added import
import { distance } from "@tscircuit/math-utils" // Added import
import {
  computeSectionScore,
  calculateSingleNodeLogSuccessProbability,
} from "./computeSectionScore" // Added import & calculateSingleNodeLogSuccessProbability
import { safeTransparentize } from "../colors" // Added import
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode" // Added import
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"

// Copied from CapacityPathingSolver
export type Candidate = {
  prevCandidate: Candidate | null
  node: CapacityMeshNode
  f: number
  g: number
  h: number
}

export interface CpssPathingSolverHyperParameters {
  SHUFFLE_SEED?: number
  EXPANSION_DEGREES?: number
}

export interface CapacityPathingSingleSectionPathingSolverParams {
  sectionNodes: CapacityMeshNode[]
  sectionEdges: CapacityMeshEdge[]
  sectionConnectionTerminals: Array<{
    // Corrected this part
    connectionName: string
    startNodeId: CapacityMeshNodeId
    endNodeId: CapacityMeshNodeId
    // Store the original full path for context if needed later
    // originalPath?: CapacityMeshNode[];
  }>
  colorMap?: Record<string, string> // Make colorMap optional in params
  centerNodeId: string
  nodeMap?: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeEdgeMap?: Map<CapacityMeshNodeId, CapacityMeshEdge[]>
  hyperParameters?: CpssPathingSolverHyperParameters
}

export class CapacityPathingSingleSectionSolver extends BaseSolver {
  override getSolverName(): string {
    return "CapacityPathingSingleSectionSolver"
  }

  GREEDY_MULTIPLIER = 1.5
  sectionNodes: CapacityMeshNode[]
  sectionEdges: CapacityMeshEdge[]
  sectionConnectionTerminals: Array<{
    connectionName: string
    startNodeId: CapacityMeshNodeId
    endNodeId: CapacityMeshNodeId
    path?: CapacityMeshNode[] // To store the result for this connection
  }>
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode> // Map of nodes *within the section*
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]> // Edges *within the section*
  colorMap: Record<string, string>
  usedNodeCapacityMap: Map<CapacityMeshNodeId, number> // Tracks capacity usage *within this solver's run*
  totalNodeCapacityMap: Map<CapacityMeshNodeId, number> // Added: Stores total capacity for each node
  centerNodeId: string
  private currentSectionScore: number = 0

  MAX_CANDIDATES_IN_MEMORY = 10_000

  // A* state
  currentConnectionIndex = 0
  candidates?: Array<Candidate> | null = null
  visitedNodes?: Set<CapacityMeshNodeId> | null = null
  queuedNodes?: Set<CapacityMeshNodeId> | null = null
  activeCandidateStraightLineDistance?: number
  debug_lastNodeCostMap: Map<
    CapacityMeshNodeId,
    {
      g: number
      h: number
      f: number
    }
  > = new Map()

  // TODO: Decide if maxCapacityFactor needs to be configurable via hyperParameters
  maxCapacityFactor = 1 // Default, similar to CapacityPathingSolver5

  constructor(params: CapacityPathingSingleSectionPathingSolverParams) {
    super()

    this.MAX_ITERATIONS = 10e3
    this.centerNodeId = params.centerNodeId
    this.sectionNodes = params.sectionNodes
    this.sectionEdges = params.sectionEdges
    // Initialize path property for each terminal
    this.sectionConnectionTerminals = params.sectionConnectionTerminals.map(
      (t) => ({ ...t, path: undefined }),
    )
    this.nodeMap =
      params.nodeMap ??
      new Map(this.sectionNodes.map((n) => [n.capacityMeshNodeId, n]))
    this.nodeEdgeMap = params.nodeEdgeMap ?? getNodeEdgeMap(this.sectionEdges) // Use only section edges
    this.colorMap = params.colorMap ?? {}

    // Initialize capacity map, potentially with starting values
    this.usedNodeCapacityMap = new Map(
      this.sectionNodes.map((node) => [node.capacityMeshNodeId, 0]),
    )
    this.totalNodeCapacityMap = new Map(
      this.sectionNodes.map((node) => [
        node.capacityMeshNodeId,
        this.getTotalCapacity(node),
      ]),
    )

    // Initialize currentSectionScore based on the initial state of capacities
    const initialSectionNodeIds = new Set(
      this.sectionNodes.map((n) => n.capacityMeshNodeId),
    )
    this.currentSectionScore = computeSectionScore({
      totalNodeCapacityMap: this.totalNodeCapacityMap,
      usedNodeCapacityMap: this.usedNodeCapacityMap, // Reflects initial capacities
      nodeMap: this.nodeMap,
      sectionNodeIds: initialSectionNodeIds,
    })

    if (params.hyperParameters?.SHUFFLE_SEED) {
      this.sectionConnectionTerminals = cloneAndShuffleArray(
        this.sectionConnectionTerminals,
        params.hyperParameters?.SHUFFLE_SEED,
      )
    }
    // Sort connections? (Maybe not necessary if order is determined by caller)
    // this.sectionConnectionTerminals.sort((a, b) => ...);
  }

  // --- Methods adapted from CapacityPathingSolver & CapacityPathingSolver5 ---

  // Adapted from CapacityPathingSolver5
  getTotalCapacity(node: CapacityMeshNode): number {
    return getTunedTotalCapacity1(node, this.maxCapacityFactor)
  }

  // Adapted from CapacityPathingSolver5
  getNodeCapacityPenalty(node: CapacityMeshNode): number {
    if (!this.nodeMap.has(node.capacityMeshNodeId)) return Infinity // Penalize leaving section heavily

    /**
     * Roughly, -1 remaining capacity is penalized to this much distance
     */
    const mmPenaltyFactor = 4

    const MIN_PENALTY = 0.05

    const totalCapacity = this.getTotalCapacity(node)
    const usedCapacity =
      this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
    const remainingCapacity = totalCapacity - usedCapacity - 1

    if (remainingCapacity > 0) {
      return 0
    }

    // const probabilityOfFailure = calculateNodeProbabilityOfFailure(
    //   usedCapacity,
    //   totalCapacity,
    //   node.availableZ.length,
    // )

    let singleLayerUsagePenaltyFactor = 1
    if (node.availableZ.length === 1) {
      singleLayerUsagePenaltyFactor = 10
    }

    return (
      (MIN_PENALTY + remainingCapacity ** 2 * mmPenaltyFactor) *
      singleLayerUsagePenaltyFactor
    )
  }

  // Adapted from CapacityPathingSolver5 (using simple distance)
  getDistanceBetweenNodes(A: CapacityMeshNode, B: CapacityMeshNode): number {
    const dx = A.center.x - B.center.x
    const dy = A.center.y - B.center.y
    return Math.sqrt(dx ** 2 + dy ** 2)
  }

  // Adapted from CapacityPathingSolver5
  computeG(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode, // endGoal is not strictly needed here but kept for signature consistency
  ): number {
    return (
      prevCandidate.g +
      this.getDistanceBetweenNodes(prevCandidate.node, node) +
      this.getNodeCapacityPenalty(node) // Apply penalty on arrival at the node
    )
  }

  // Adapted from CapacityPathingSolver5
  computeH(
    prevCandidate: Candidate, // prevCandidate not strictly needed here
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ): number {
    // Heuristic is distance to goal + estimated penalty at the current node
    return (
      this.getDistanceBetweenNodes(node, endGoal) +
      this.getNodeCapacityPenalty(node) // Consider penalty of the current node for heuristic
    )
  }

  // Adapted from CapacityPathingSolver
  getBacktrackedPath(candidate: Candidate): CapacityMeshNode[] {
    const path: CapacityMeshNode[] = []
    let currentCandidate: Candidate | null = candidate
    while (currentCandidate) {
      path.push(currentCandidate.node)
      // Ensure the node exists in our section map before adding
      if (this.nodeMap.has(currentCandidate.node.capacityMeshNodeId)) {
        currentCandidate = currentCandidate.prevCandidate
      } else {
        // Should not happen if search stays within bounds, but safety break
        console.warn("Backtracked path went outside section bounds")
        break
      }
    }
    return path.reverse() // Path is built end-to-start, reverse it
  }

  // Adapted from CapacityPathingSolver - uses section's nodeEdgeMap
  getNeighboringNodes(node: CapacityMeshNode): CapacityMeshNode[] {
    if (!this.nodeMap.has(node.capacityMeshNodeId)) return [] // Node not in section

    return (
      this.nodeEdgeMap
        .get(node.capacityMeshNodeId)
        ?.flatMap((edge): CapacityMeshNodeId[] =>
          edge.nodeIds.filter((n) => n !== node.capacityMeshNodeId),
        )
        .map((nId) => this.nodeMap.get(nId)!)
        .filter(Boolean) ?? [] // Ensure nodes exist in the section map and filter out undefined
    )
  }

  // Adapted from CapacityPathingSolver - uses section's nodeEdgeMap
  isConnectedToEndGoal(
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ): boolean {
    if (
      !this.nodeMap.has(node.capacityMeshNodeId) ||
      !this.nodeMap.has(endGoal.capacityMeshNodeId)
    )
      return false

    return (this.nodeEdgeMap.get(node.capacityMeshNodeId) ?? []).some((edge) =>
      edge.nodeIds.includes(endGoal.capacityMeshNodeId),
    )
  }

  // Adapted from CapacityPathingSolver - uses section's capacity map and total capacity calculation
  doesNodeHaveCapacityForTrace(
    node: CapacityMeshNode,
    prevNode: CapacityMeshNode | null, // Can be null for the start node
  ): boolean {
    return true
  }

  // Adapted from CapacityPathingSolver - uses section's capacity map
  reduceCapacityAlongPath(path: CapacityMeshNode[]) {
    for (const pathNode of path) {
      // Only reduce capacity and update score for nodes within our section
      if (this.usedNodeCapacityMap.has(pathNode.capacityMeshNodeId)) {
        const nodeId = pathNode.capacityMeshNodeId
        const nodeInSection = this.nodeMap.get(nodeId)

        if (!nodeInSection) {
          // This should ideally not happen if paths are constrained to section nodes
          console.warn(
            `Node ${nodeId} from path not found in section's nodeMap during score update.`,
          )
          continue
        }

        const totalCapacity = this.totalNodeCapacityMap.get(nodeId)!
        const oldUsedCapacity = this.usedNodeCapacityMap.get(nodeId) ?? 0

        // Subtract the score contribution of the node with its old capacity
        const oldNodeScoreContribution =
          calculateSingleNodeLogSuccessProbability(
            oldUsedCapacity,
            totalCapacity,
            nodeInSection, // Use the node object from the section's map
          )
        this.currentSectionScore -= oldNodeScoreContribution

        // Increment the used capacity for the node
        const newUsedCapacity = oldUsedCapacity + 1
        this.usedNodeCapacityMap.set(nodeId, newUsedCapacity)

        // Add the score contribution of the node with its new capacity
        const newNodeScoreContribution =
          calculateSingleNodeLogSuccessProbability(
            newUsedCapacity,
            totalCapacity,
            nodeInSection, // Use the node object from the section's map
          )
        this.currentSectionScore += newNodeScoreContribution
      }
    }
  }

  getSolvedSectionScore(): number {
    return this.currentSectionScore
  }

  _step() {
    const currentTerminal =
      this.sectionConnectionTerminals[this.currentConnectionIndex]
    if (!currentTerminal) {
      this.solved = true // All connections processed
      return
    }

    const startNode = this.nodeMap.get(currentTerminal.startNodeId)
    const endNode = this.nodeMap.get(currentTerminal.endNodeId)

    if (!startNode || !endNode) {
      console.error(
        `Start or end node not found in section for connection ${currentTerminal.connectionName}`,
      )
      // Mark this connection as failed? Or skip?
      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      // Consider setting this.failed = true if any connection fails critically
      return
    }

    // Initialize A* for the current connection if not already started
    if (!this.candidates) {
      this._setupAStar(startNode, endNode)
    }

    const candidates = this.candidates!

    if (candidates.length === 0) {
      this._handleCandidatesExhausted(currentTerminal)
      return
    }

    candidates.sort((a, b) => a.f - b.f)
    const currentCandidate = candidates.shift()! // Not null due to check above
    if (candidates.length > this.MAX_CANDIDATES_IN_MEMORY) {
      candidates.splice(
        this.MAX_CANDIDATES_IN_MEMORY,
        candidates.length - this.MAX_CANDIDATES_IN_MEMORY,
      )
    }

    // Add the node selected for expansion to the visited/closed set
    this.visitedNodes!.add(currentCandidate.node.capacityMeshNodeId)

    // Check if goal reached
    // Use direct ID check first, then isConnectedToEndGoal if needed (e.g., for adjacent nodes)
    if (
      currentCandidate.node.capacityMeshNodeId === endNode.capacityMeshNodeId
    ) {
      this._handleGoalReached(currentCandidate, currentTerminal, endNode)
      return
    }

    // Explore neighbors
    const neighborNodes = this.getNeighboringNodes(currentCandidate.node)
    for (const neighborNode of neighborNodes) {
      // Skip if already visited
      if (this.queuedNodes?.has(neighborNode.capacityMeshNodeId)) {
        continue
      }

      // Skip if node lacks capacity (using the adapted check)
      // Note: doesNodeHaveCapacityForTrace currently always returns true in this solver,
      // capacity is handled via penalties. Keep the check structure for potential future changes.
      if (
        !this.doesNodeHaveCapacityForTrace(neighborNode, currentCandidate.node)
      ) {
        continue
      }

      // Skip if it's an obstacle node and not a designated terminal for *this* connection
      if (neighborNode._containsObstacle) {
        const isStartTerminal =
          neighborNode.capacityMeshNodeId === currentTerminal.startNodeId
        const isEndTerminal =
          neighborNode.capacityMeshNodeId === currentTerminal.endNodeId
        if (!isStartTerminal && !isEndTerminal) {
          continue // Skip this neighbor as it's an obstacle and not a terminal
        }
      }

      // Calculate costs
      const g = this.computeG(currentCandidate, neighborNode, endNode)
      const h = this.computeH(currentCandidate, neighborNode, endNode)
      const f = g + h * this.GREEDY_MULTIPLIER

      this.debug_lastNodeCostMap.set(neighborNode.capacityMeshNodeId, {
        f,
        g,
        h,
      })

      // Create and add the new candidate
      const newCandidate: Candidate = {
        prevCandidate: currentCandidate,
        node: neighborNode,
        f,
        g,
        h,
      }
      this.queuedNodes?.add(neighborNode.capacityMeshNodeId)
      candidates!.push(newCandidate)
      // Do NOT add to visitedNodes here. Add only when a node is popped from candidates.
    }

    // Mark current node as fully processed (closed list) - This happens when the node is popped from candidates and added to visitedNodes.
    // No, visitedNodes is the open list + closed list. Let's stick to adding when pushing to candidates.
    // this.visitedNodes!.add(currentCandidate.node.capacityMeshNodeId); // This seems redundant if added above
  }

  computeProgress(): number {
    const totalConnections = this.sectionConnectionTerminals.length
    if (totalConnections === 0) return 1 // No work to do

    // Base progress based on completed connections
    const completedConnections = this.currentConnectionIndex
    let progress = completedConnections / totalConnections

    // Refine progress based on the current connection's A* search
    if (
      this.currentConnectionIndex < totalConnections &&
      this.candidates &&
      this.candidates.length > 0 &&
      this.activeCandidateStraightLineDistance &&
      this.activeCandidateStraightLineDistance > 0
    ) {
      // Find the candidate with the lowest h value (closest to the goal heuristically)
      // Note: Sorting by f is standard A*, but for progress, lowest h is more indicative.
      // Let's use the best candidate (lowest f) as a proxy, assuming h contributes significantly.
      const bestCandidate = this.candidates.reduce((best, current) =>
        current.f < best.f ? current : best,
      )

      // Estimate progress within the current connection: 1 - (current_h / initial_h)
      // Clamp between 0 and 1, as h might increase due to penalties
      const currentConnectionProgress = Math.max(
        0,
        Math.min(
          1,
          1 - bestCandidate.h / this.activeCandidateStraightLineDistance,
        ),
      )

      // Add the fractional progress of the current connection
      progress += currentConnectionProgress / totalConnections
    } else if (this.solved) {
      progress = 1 // Ensure progress is 1 when solved
    }

    return Math.min(1, progress) // Clamp final progress to 1
  }

  private _setupAStar(startNode: CapacityMeshNode, endNode: CapacityMeshNode) {
    this.candidates = [
      { prevCandidate: null, node: startNode, f: 0, g: 0, h: 0 },
    ]
    this.visitedNodes = new Set([startNode.capacityMeshNodeId])
    this.debug_lastNodeCostMap = new Map() // Reset costs for the new connection
    this.activeCandidateStraightLineDistance = distance(
      startNode.center,
      endNode.center,
    )

    // Initial cost calculation for start node
    const initialH = this.computeH(null!, startNode, endNode)
    this.candidates[0].h = initialH
    this.candidates[0].f = initialH * this.GREEDY_MULTIPLIER // g is 0
    this.debug_lastNodeCostMap.set(startNode.capacityMeshNodeId, {
      f: this.candidates[0].f,
      g: 0,
      h: initialH,
    })
    this.queuedNodes = new Set([startNode.capacityMeshNodeId])
  }

  private _handleCandidatesExhausted(currentTerminal: {
    connectionName: string
  }) {
    console.error(
      `Ran out of candidates for section connection ${currentTerminal.connectionName}`,
    )
    // Failed to find path for this connection
    this.currentConnectionIndex++
    this.candidates = null
    this.visitedNodes = null
    this.queuedNodes = null
    // Optionally mark the solver as failed if any path fails
    // this.failed = true;
  }

  private _handleGoalReached(
    currentCandidate: Candidate,
    currentTerminal: {
      connectionName: string
      startNodeId: CapacityMeshNodeId
      endNodeId: CapacityMeshNodeId
      path?: CapacityMeshNode[]
    },
    endNode: CapacityMeshNode, // Pass endNode if needed for checks like isConnectedToEndGoal
  ) {
    // Found the path for the current connection
    const path = this.getBacktrackedPath(currentCandidate)
    // If using isConnectedToEndGoal, might need to add endNode explicitly if not the current node
    // if (path[path.length - 1]?.capacityMeshNodeId !== endNode.capacityMeshNodeId) {
    //    path.push(endNode);
    // }

    currentTerminal.path = path // Store the found path
    this.reduceCapacityAlongPath(path) // Update capacity usage

    // Move to the next connection
    this.currentConnectionIndex++
    this.candidates = null
    this.visitedNodes = null
    this.queuedNodes = null
  }

  visualize(): GraphicsObject {
    // Prepare data for completed paths visualization
    const completedPathsForViz = this.sectionConnectionTerminals
      .filter((t) => t.path && t.path.length > 0) // Only include terminals with a solved path
      .map((t) => ({
        connectionName: t.connectionName,
        path: t.path!, // Assert path is defined due to filter
      }))

    // Base visualization from visualizeSection
    const baseGraphics = visualizeSection({
      sectionNodes: this.sectionNodes,
      sectionEdges: this.sectionEdges,
      sectionConnectionTerminals: this.sectionConnectionTerminals, // Still pass terminals for start/end points
      completedPaths: completedPathsForViz, // Pass the solved paths
      nodeMap: this.nodeMap, // Pass the section's node map
      colorMap: this.colorMap,
      centerNodeId: null, // No single center node for pathing visualization
      title: `Section Pathing: Conn ${this.currentConnectionIndex + 1}/${
        this.sectionConnectionTerminals.length
      } (${this.sectionNodes.length} nodes)`,
      nodeOpacity: 0.1,
    })

    // Enhance with A* specific visualization (Keep this part)

    // 1. Highlight node costs (f, g, h) and capacity usage
    for (const node of this.sectionNodes) {
      const rectIndex = baseGraphics.rects!.findIndex((r) =>
        r.label?.includes(node.capacityMeshNodeId),
      )
      if (rectIndex !== -1) {
        const costs = this.debug_lastNodeCostMap.get(node.capacityMeshNodeId)
        const usedCapacity =
          this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
        const totalCapacity = this.getTotalCapacity(node)
        const capacityLabel = `${usedCapacity.toFixed(1)}/${totalCapacity.toFixed(
          1,
        )}`
        const costLabel = costs
          ? `f:${costs.f.toFixed(1)} g:${costs.g.toFixed(
              1,
            )} h:${costs.h.toFixed(1)}`
          : "cost:?"

        baseGraphics.rects![rectIndex].label = [
          node.capacityMeshNodeId,
          `Cap: ${capacityLabel}`,
          costLabel,
          `Z: ${node.availableZ.join(",")}`,
        ].join("\n")

        // Add stroke if over capacity
        if (usedCapacity > totalCapacity) {
          baseGraphics.rects![rectIndex].stroke = safeTransparentize("red", 0.7)
        }
      }
    }

    // 2. Visualize candidate paths (top few)
    if (this.candidates && this.candidates.length > 0) {
      const topCandidates = this.candidates
        .slice() // Create a copy
        .sort((a, b) => a.f - b.f) // Ensure sorted by f-cost
        .slice(0, 5) // Take top 5

      const currentTerminal =
        this.sectionConnectionTerminals[this.currentConnectionIndex]
      const connectionName = currentTerminal?.connectionName ?? "unknown"
      const connectionColor = this.colorMap[connectionName] ?? "purple" // Default color

      topCandidates.forEach((candidate, index) => {
        const opacity = 0.8 * (1 - index / 5) // Decreasing opacity
        const path = this.getBacktrackedPath(candidate)
        if (path.length > 0) {
          baseGraphics.lines!.push({
            points: path.map(({ center: { x, y } }) => ({ x, y })),
            strokeColor: safeTransparentize(connectionColor, 1 - opacity),
            strokeWidth: 0.05,
          })
        }
      })
    }

    return baseGraphics
  }
}

/* @deprecated use CapacityPathingSingleSectionPathingSolver */
export const CapacityPathingSingleSectionPathingSolver =
  CapacityPathingSingleSectionSolver
export type CapacityPathingSingleSectionPathingSolver = InstanceType<
  typeof CapacityPathingSingleSectionSolver
>

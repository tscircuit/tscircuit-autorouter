import { CapacityPathingGreedySolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingGreedySolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
  SimpleRouteJson,
  CapacityPath,
} from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { getNodeEdgeMap } from "lib/solvers/CapacityMeshSolver/getNodeEdgeMap"
import {
  cloneAndShuffleArray,
  seededRandom,
} from "lib/utils/cloneAndShuffleArray"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { GraphicsObject } from "graphics-debug"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { safeTransparentize } from "lib/solvers/colors"
import { distance } from "@tscircuit/math-utils"

const seededRandomDecision = (seeds: number[], chance: number) => {
  const seed = seeds.reduce(
    (acc, seed) => acc + ((seed * 16807) % 2147483647),
    0,
  )
  const random = seededRandom(seed)
  return random() < chance
}

export type Candidate = {
  prevCandidate: Candidate | null
  node: CapacityMeshNode
  f: number
  g: number
  h: number
}

type AssignableViaCapacityHyperParameters = Partial<CapacityHyperParameters> & {
  SHUFFLE_SEED?: number

  DIRECTIVE_SEED?: number

  FORCE_VIA_TRAVEL_CHANCE?: number
  FAR_VIA_MIN_DISTANCE?: number
  MAX_CLOSEST_VIA_SKIP?: number
  MAX_FURTHEST_VIA_SKIP?: number
}

type ConnectionNodePair = {
  start: CapacityMeshNode
  end: CapacityMeshNode
  connection: SimpleRouteConnection
}

type SubpathNodePair = {
  start: CapacityMeshNode
  end: CapacityMeshNode
  solved: boolean
  path?: CapacityMeshNode[]
  layer: number // Designated z-layer for this subpath
}

export type ConnectionPathWithNodes = {
  connection: SimpleRouteConnection
  path: CapacityMeshNode[]
}

/**
 * See description in the prompt
 */
export class AssignableViaCapacityPathingSolver_DirectiveSubOptimal extends BaseSolver {
  /**
   * Bias toward greedier choices (f = g + GREEDY_MULTIPLIER * h)
   */
  GREEDY_MULTIPLIER = 1.5

  simpleRouteJson: SimpleRouteJson
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  colorMap: Record<string, string>
  MAX_ITERATIONS: number
  hyperParameters: Partial<AssignableViaCapacityHyperParameters>
  usedNodeMap: Map<CapacityMeshNodeId, true> = new Map()
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>

  unprocessedConnectionPairs: ConnectionNodePair[]
  solvedRoutes: ConnectionPathWithNodes[] = []

  activeConnectionPair: ConnectionNodePair | null = null

  ogUnprocessedSubpaths: SubpathNodePair[] | null = null
  unprocessedSubpaths: SubpathNodePair[] | null = null
  solvedSubpaths: SubpathNodePair[] | null = null

  activeSubpath: SubpathNodePair | null = null

  viaNodes: CapacityMeshNode[] = []

  // Map to store the closest via for the start node of each connection pair
  closestViaForConnectionStartMap: Map<ConnectionNodePair, CapacityMeshNode> =
    new Map()

  // Map to store the closest via for the end node of each connection pair
  closestViaForConnectionEndMap: Map<ConnectionNodePair, CapacityMeshNode> =
    new Map()

  constructor(
    private inputParams: {
      simpleRouteJson: SimpleRouteJson
      nodes: CapacityMeshNode[]
      edges: CapacityMeshEdge[]
      colorMap?: Record<string, string>
      MAX_ITERATIONS?: number
      hyperParameters?: Partial<AssignableViaCapacityHyperParameters>
    },
  ) {
    const {
      simpleRouteJson,
      nodes,
      edges,
      colorMap,
      MAX_ITERATIONS = 1e6,
      hyperParameters = {},
    } = inputParams
    super()
    this.hyperParameters = hyperParameters
    this.MAX_ITERATIONS = MAX_ITERATIONS
    this.simpleRouteJson = simpleRouteJson
    this.nodes = nodes
    this.edges = edges
    this.colorMap = colorMap ?? {}
    this.nodeMap = new Map(
      this.nodes.map((node) => [node.capacityMeshNodeId, node]),
    )
    this.nodeEdgeMap = getNodeEdgeMap(this.edges)

    const nodesWithTargets = this.nodes.filter((node) => node._containsTarget)
    this.unprocessedConnectionPairs = cloneAndShuffleArray(
      this.simpleRouteJson.connections.map((conn) => {
        const [startPtC, endPtC] = conn.pointsToConnect

        // Find node containing start point
        const startNode = nodesWithTargets.find(
          (n) => distance(n.center, startPtC) < n.width / 2,
        )!
        const endNode = nodesWithTargets.find(
          (n) => distance(n.center, endPtC) < n.width / 2,
        )!

        return {
          start: startNode,
          end: endNode,
          connection: conn,
        }
      }),
      this.hyperParameters.SHUFFLE_SEED ?? 0,
    )

    // "Via" nodes are those with multiple available Z-layers
    this.viaNodes = this.nodes.filter((node) => node.availableZ.length > 1)
  }

  getConstructorParams(): typeof this.inputParams {
    return this.inputParams
  }

  lastStepOperation:
    | "none"
    | "dequeueConnectionPair"
    | "breakConnectionPairIntoSubpaths"
    | "dequeueSubpath"
    | "stepSolveSubpath"
    | "finishedSolvingSubpath"
    | "finishedSolvingConnectionPair" = "none"

  /**
   * Computes and stores the closest via for both start and end of each unprocessed connection pair.
   * This is used to ensure we don't "steal" a via that's closest to another connection.
   */
  computeClosestViaForAllConnections() {
    this.closestViaForConnectionStartMap.clear()
    this.closestViaForConnectionEndMap.clear()

    for (const connectionPair of this.unprocessedConnectionPairs) {
      // Find the closest available via to this connection's start node
      const availableVias = this.viaNodes
        .filter((v) => !v._completelyInsideObstacle && !v._containsObstacle)
        .filter((v) => !this.usedNodeMap.has(v.capacityMeshNodeId))

      if (availableVias.length > 0) {
        // Compute closest via to start node
        const closestViaToStart = availableVias.reduce((closest, via) => {
          const distToClosest = this._dist(closest, connectionPair.start)
          const distToVia = this._dist(via, connectionPair.start)
          return distToVia < distToClosest ? via : closest
        })
        this.closestViaForConnectionStartMap.set(
          connectionPair,
          closestViaToStart,
        )

        // Compute closest via to end node
        const closestViaToEnd = availableVias.reduce((closest, via) => {
          const distToClosest = this._dist(closest, connectionPair.end)
          const distToVia = this._dist(via, connectionPair.end)
          return distToVia < distToClosest ? via : closest
        })
        this.closestViaForConnectionEndMap.set(connectionPair, closestViaToEnd)
      }
    }
  }

  _step() {
    if (!this.activeConnectionPair) {
      this.activeConnectionPair = this.unprocessedConnectionPairs.shift()!
      if (!this.activeConnectionPair) {
        this.solved = true
        return
      }
      // Compute closest via for all remaining connections to avoid stealing vias
      this.computeClosestViaForAllConnections()
      this.lastStepOperation = "dequeueConnectionPair"
      return
    }

    if (this.activeConnectionPair && !this.unprocessedSubpaths) {
      this.unprocessedSubpaths = this.breakConnectionPairIntoSubpaths(
        this.activeConnectionPair,
      )
      this.ogUnprocessedSubpaths = this.unprocessedSubpaths.slice()
      this.solvedSubpaths = []
      this.lastStepOperation = "breakConnectionPairIntoSubpaths"
      return
    }

    if (!this.activeSubpath) {
      this.activeSubpath = this.unprocessedSubpaths!.shift()!
      if (!this.activeSubpath) {
        // Save the connection pair before nulling it
        const completedConnectionPair = this.activeConnectionPair
        this.activeConnectionPair = null
        this.unprocessedSubpaths = null
        this.ogUnprocessedSubpaths = null
        this.activeSubpath = null

        this.solvedRoutes.push(
          this.createSolvedRoute(
            this.solvedSubpaths!,
            completedConnectionPair!,
          ),
        )

        this.lastStepOperation = "finishedSolvingConnectionPair"
        return
      }

      this.lastStepOperation = "dequeueSubpath"
      return
    }

    if (this.activeSubpath) {
      this.stepSolveSubpath(this.activeSubpath)

      if (this.activeSubpath!.solved) {
        this.solvedSubpaths!.push(this.activeSubpath)
        this.activeSubpath = null
        this.clearCandidateNodes()
        this.lastStepOperation = "finishedSolvingSubpath"
        return
      }
    }

    this.lastStepOperation = "stepSolveSubpath"
  }

  queuedCandidateNodes: Candidate[] = []
  visitedNodes: Set<CapacityMeshNodeId> = new Set()

  private _dist(a: CapacityMeshNode, b: CapacityMeshNode): number {
    return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)
  }

  stepSolveSubpath(subpath: SubpathNodePair) {
    const { start, end } = subpath

    // Trivial case
    if (start.capacityMeshNodeId === end.capacityMeshNodeId) {
      subpath.path = [start]
      subpath.solved = true
      // mark single node as used
      this.usedNodeMap.set(start.capacityMeshNodeId, true)
      return
    }

    // Seed the queue with the start node if empty
    if (
      this.queuedCandidateNodes.length === 0 &&
      this.visitedNodes.size === 0
    ) {
      const h0 = this._dist(start, end)
      const startCandidate: Candidate = {
        prevCandidate: null,
        node: start,
        g: 0,
        h: h0,
        f: this.GREEDY_MULTIPLIER * h0,
      }
      this.queuedCandidateNodes.push(startCandidate)
    }

    // Sort by lowest f (greedy leaning A*)
    this.queuedCandidateNodes.sort((a, b) => a.f - b.f)

    // Dequeue the next viable candidate (skip already visited)
    let current: Candidate | undefined
    while (this.queuedCandidateNodes.length && !current) {
      const cand = this.queuedCandidateNodes.shift()!
      if (!this.visitedNodes.has(cand.node.capacityMeshNodeId)) {
        current = cand
      }
    }

    // Nothing left to expand — declare solved to avoid deadlock,
    // but we won't mark any additional nodes as used.
    if (!current) {
      this.failed = true
      this.error = "No viable candidates left"
      return
    }

    // Mark visited
    this.visitedNodes.add(current.node.capacityMeshNodeId)

    // Goal check
    if (current.node.capacityMeshNodeId === end.capacityMeshNodeId) {
      // Backtrack and collect the path, marking nodes as used
      const path: CapacityMeshNode[] = []
      let walk: Candidate | null = current
      while (walk) {
        path.unshift(walk.node)
        this.usedNodeMap.set(walk.node.capacityMeshNodeId, true)
        walk = walk.prevCandidate
      }
      subpath.path = path
      subpath.solved = true
      return
    }

    // Expand neighbors (single-step expansion per _step tick)
    const neighbors = this.getNeighbors(current.node)
    for (const n of neighbors) {
      const id = n.capacityMeshNodeId
      if (this.visitedNodes.has(id)) continue

      // Compute costs
      const g = this.computeG(current, n, end)
      const h = this.computeH(current, n, end)
      const f = g + this.GREEDY_MULTIPLIER * h

      const existingIndex = this.queuedCandidateNodes.findIndex(
        (c) => c.node.capacityMeshNodeId === id,
      )
      if (existingIndex >= 0) {
        if (this.queuedCandidateNodes[existingIndex].g <= g) {
          continue // worse than an existing queued path
        }
        // Replace with a better path
        this.queuedCandidateNodes.splice(existingIndex, 1)
      }

      this.queuedCandidateNodes.push({
        prevCandidate: current,
        node: n,
        g,
        h,
        f,
      })
    }
  }

  getNeighbors(node: CapacityMeshNode): CapacityMeshNode[] {
    const neighbors = new Set<CapacityMeshNode>()

    const edges = this.nodeEdgeMap.get(node.capacityMeshNodeId) ?? []
    for (const e of edges) {
      const [a, b] = e.nodeIds
      const otherId = a === node.capacityMeshNodeId ? b : a
      const nn = this.nodeMap.get(otherId)
      if (nn) neighbors.add(nn)
    }

    // Filter out hard obstacles (non-traversable) AND nodes that don't have the designated layer
    const designatedLayer = this.activeSubpath?.layer
    return Array.from(neighbors).filter((n) => {
      const isGoalNode =
        n.capacityMeshNodeId === this.activeSubpath?.end.capacityMeshNodeId

      if (isGoalNode) return true
      // Must not be obstacle
      if (n._containsObstacle) return false

      // Must not be an unrelated target
      if (n._containsTarget) return false

      if (this.usedNodeMap.has(n.capacityMeshNodeId)) return false

      if (
        designatedLayer !== undefined &&
        !n.availableZ.includes(designatedLayer)
      ) {
        return false
      }

      return true
    })
  }

  clearCandidateNodes() {
    this.queuedCandidateNodes = []
    this.visitedNodes = new Set()
  }

  computeG(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    _endGoal: CapacityMeshNode,
  ) {
    // Base movement cost: Euclidean step
    const step = this._dist(prevCandidate.node, node)
    const g = prevCandidate.g + step
    return g
  }

  computeH(
    _prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    // Straight-line heuristic to the goal
    const h = this._dist(node, endGoal)

    return h
  }

  createSolvedRoute(
    subpaths: SubpathNodePair[],
    connectionPair: ConnectionNodePair,
  ): ConnectionPathWithNodes {
    // Concatenate all subpath paths, avoiding duplicate nodes at boundaries
    const fullPath: CapacityMeshNode[] = []

    for (let i = 0; i < subpaths.length; i++) {
      const subpath = subpaths[i]
      if (!subpath.path) {
        // Fallback: if path wasn't stored, just use start and end
        if (i === 0) {
          fullPath.push(subpath.start)
        }
        if (i === subpaths.length - 1) {
          fullPath.push(subpath.end)
        }
      } else {
        if (i === 0) {
          // First subpath: add all nodes
          fullPath.push(...subpath.path)
        } else {
          // Subsequent subpaths: skip first node (it's the same as the last node of previous path)
          fullPath.push(...subpath.path.slice(1))
        }
      }
    }

    return {
      connection: connectionPair.connection,
      path: fullPath,
    }
  }

  breakConnectionPairIntoSubpaths(
    connectionPair: ConnectionNodePair,
  ): SubpathNodePair[] {
    const shouldForceTravel = seededRandomDecision(
      [this.hyperParameters.DIRECTIVE_SEED ?? 0, this.solvedRoutes.length],
      this.hyperParameters.FORCE_VIA_TRAVEL_CHANCE ?? 0,
    )
    if (!shouldForceTravel) {
      // Find common layer between start and end, default to first available layer
      return [
        {
          start: connectionPair.start,
          end: connectionPair.end,
          solved: false,
          layer: connectionPair.start.availableZ[0] ?? 0,
        },
      ]
    }

    // Choose directive vias
    const closestVia = this.getClosestVia(connectionPair.start)
    const farVia = this.getFarVia(closestVia, connectionPair.end)

    const startLayer = connectionPair.start.availableZ[0] ?? 0
    const endLayer = connectionPair.end.availableZ[0] ?? 0

    // Assign different layers to each subpath
    const subpaths: SubpathNodePair[] = []
    subpaths.push({
      start: connectionPair.start,
      end: closestVia,
      solved: false,
      layer: startLayer,
    })
    if (startLayer === endLayer) {
      subpaths.push({
        start: closestVia,
        end: farVia,
        solved: false,
        layer: startLayer === 0 ? 1 : 0,
      })
      subpaths.push({
        start: farVia,
        end: connectionPair.end,
        solved: false,
        layer: endLayer,
      })
    } else {
      subpaths.push({
        start: closestVia,
        end: connectionPair.end,
        solved: false,
        layer: endLayer,
      })
    }
    return subpaths
  }

  getClosestVia(node: CapacityMeshNode): CapacityMeshNode {
    if (this.viaNodes.length === 0) return node

    // Get the set of vias that are closest to other connections (start or end)
    const reservedVias = new Set<CapacityMeshNodeId>()

    // Check vias reserved for start nodes of other connections
    for (const [connectionPair, closestVia] of this
      .closestViaForConnectionStartMap) {
      // Don't mark as reserved if this is the current active connection pair
      if (connectionPair !== this.activeConnectionPair) {
        reservedVias.add(closestVia.capacityMeshNodeId)
      }
    }

    // Check vias reserved for end nodes of other connections
    for (const [connectionPair, closestVia] of this
      .closestViaForConnectionEndMap) {
      // Don't mark as reserved if this is the current active connection pair
      if (connectionPair !== this.activeConnectionPair) {
        reservedVias.add(closestVia.capacityMeshNodeId)
      }
    }

    // Exclude blocked vias, used vias, and vias reserved for other connections
    const candidates = this.viaNodes
      .filter((v) => !v._completelyInsideObstacle && !v._containsObstacle)
      .filter((v) => !this.usedNodeMap.has(v.capacityMeshNodeId))
      .filter((v) => !reservedVias.has(v.capacityMeshNodeId))

    // If no candidates after filtering, fall back to any available via (including reserved ones)
    if (candidates.length === 0) {
      const fallbackCandidates = this.viaNodes
        .filter((v) => !v._completelyInsideObstacle && !v._containsObstacle)
        .filter((v) => !this.usedNodeMap.has(v.capacityMeshNodeId))
      if (fallbackCandidates.length === 0) return node
      fallbackCandidates.sort(
        (a, b) => this._dist(a, node) - this._dist(b, node),
      )
      return fallbackCandidates[0]
    }

    candidates.sort((a, b) => this._dist(a, node) - this._dist(b, node))

    // Apply MAX_CLOSEST_VIA_SKIP if configured
    const maxSkip = this.hyperParameters.MAX_CLOSEST_VIA_SKIP ?? 0
    if (maxSkip > 0 && candidates.length > 1) {
      // Generate seeded random number K between 0 and MAX_CLOSEST_VIA_SKIP
      const seed =
        (this.hyperParameters.DIRECTIVE_SEED ?? 0) + this.solvedRoutes.length
      const random = seededRandom(seed)
      const k = Math.floor(random() * (maxSkip + 1))

      // Skip the first k vias, but ensure we don't go out of bounds
      const skipIndex = Math.min(k, candidates.length - 1)
      return candidates[skipIndex]
    }

    return candidates[0]
  }

  getFarVia(
    closestVia: CapacityMeshNode,
    end: CapacityMeshNode,
  ): CapacityMeshNode {
    if (this.viaNodes.length === 0) return closestVia

    const minD =
      this.hyperParameters.FAR_VIA_MIN_DISTANCE != null
        ? this.hyperParameters.FAR_VIA_MIN_DISTANCE
        : 50

    // Get the set of vias that are closest to other connections (start or end)
    const reservedVias = new Set<CapacityMeshNodeId>()

    // Check vias reserved for start nodes of other connections
    for (const [connectionPair, closestViaForConnection] of this
      .closestViaForConnectionStartMap) {
      // Don't mark as reserved if this is the current active connection pair
      if (connectionPair !== this.activeConnectionPair) {
        reservedVias.add(closestViaForConnection.capacityMeshNodeId)
      }
    }

    // Check vias reserved for end nodes of other connections
    for (const [connectionPair, closestViaForConnection] of this
      .closestViaForConnectionEndMap) {
      // Don't mark as reserved if this is the current active connection pair
      if (connectionPair !== this.activeConnectionPair) {
        reservedVias.add(closestViaForConnection.capacityMeshNodeId)
      }
    }

    // Filter vias: exclude used, obstacles, reserved, closestVia, and those too close to closestVia
    const viable = this.viaNodes.filter(
      (v) =>
        !this.usedNodeMap.has(v.capacityMeshNodeId) &&
        v.capacityMeshNodeId !== closestVia.capacityMeshNodeId &&
        !v._completelyInsideObstacle &&
        !v._containsObstacle &&
        !reservedVias.has(v.capacityMeshNodeId) &&
        this._dist(v, closestVia) >= minD,
    )

    if (viable.length === 0) {
      // Fall back: try without the reserved filter
      const fallback = this.viaNodes
        .filter(
          (v) =>
            v.capacityMeshNodeId !== closestVia.capacityMeshNodeId &&
            !v._completelyInsideObstacle &&
            !v._containsObstacle &&
            !this.usedNodeMap.has(v.capacityMeshNodeId) &&
            this._dist(v, closestVia) >= minD,
        )
        .sort((a, b) => this._dist(a, end) - this._dist(b, end))

      if (fallback.length > 0) return fallback[0]

      // Final fallback: any available via
      const finalFallback = this.viaNodes
        .filter(
          (v) =>
            v.capacityMeshNodeId !== closestVia.capacityMeshNodeId &&
            !v._completelyInsideObstacle &&
            !v._containsObstacle &&
            !this.usedNodeMap.has(v.capacityMeshNodeId),
        )
        .sort((a, b) => this._dist(a, end) - this._dist(b, end))[0]

      return finalFallback ?? closestVia
    }

    // Sort by distance to goal (end) - optimize for vias closest to the goal
    viable.sort((a, b) => this._dist(a, end) - this._dist(b, end))

    // Apply MAX_FURTHEST_VIA_SKIP if configured
    const maxSkip = this.hyperParameters.MAX_FURTHEST_VIA_SKIP ?? 0
    if (maxSkip > 0 && viable.length > 1) {
      // Generate seeded random number K between 0 and MAX_FURTHEST_VIA_SKIP
      const seed =
        (this.hyperParameters.DIRECTIVE_SEED ?? 0) +
        this.solvedRoutes.length +
        1000
      const random = seededRandom(seed)
      const k = Math.floor(random() * (maxSkip + 1))

      // Skip the first k vias, but ensure we don't go out of bounds
      const skipIndex = Math.min(k, viable.length - 1)
      return viable[skipIndex]
    }

    return viable[0]
  }

  getCapacityPaths(): CapacityPath[] {
    const capacityPaths: CapacityPath[] = []
    for (const solvedRoute of this.solvedRoutes) {
      const path = solvedRoute.path
      if (path && path.length > 0) {
        capacityPaths.push({
          capacityPathId: solvedRoute.connection.name,
          connectionName: solvedRoute.connection.name,
          nodeIds: path.map((node) => node.capacityMeshNodeId),
        })
      }
    }
    return capacityPaths
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Helper to check if a point is valid (no NaN, no Infinity)
    const isValidPoint = (
      point: { x: number; y: number } | undefined | null,
    ): boolean => {
      return (
        !!point &&
        typeof point.x === "number" &&
        typeof point.y === "number" &&
        !Number.isNaN(point.x) &&
        !Number.isNaN(point.y) &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
      )
    }

    // Helper to check if a number is valid
    const isValidNumber = (num: number | undefined | null): boolean => {
      return (
        typeof num === "number" && !Number.isNaN(num) && Number.isFinite(num)
      )
    }

    // 1. Visualize ALL nodes as rectangles with detailed labels
    for (const node of this.nodes) {
      const isInCandidates = this.queuedCandidateNodes.some(
        (c) => c.node.capacityMeshNodeId === node.capacityMeshNodeId,
      )
      const candidate = this.queuedCandidateNodes.find(
        (c) => c.node.capacityMeshNodeId === node.capacityMeshNodeId,
      )

      if (
        isValidPoint(node.center) &&
        isValidNumber(node.width) &&
        isValidNumber(node.height)
      ) {
        const rect = createRectFromCapacityNode(node, {
          rectMargin: 0.025,
          zOffset: 0.01,
        })

        graphics.rects!.push({
          ...rect,
          fill: isInCandidates
            ? "rgba(255, 128, 255, 0.5)"
            : node._containsTarget
              ? "rgba(0, 150, 255, 0.15)"
              : node._containsObstacle
                ? "rgba(255, 0, 0, 0.1)"
                : "rgba(200, 200, 200, 0.05)",
          label: [
            `ID: ${node.capacityMeshNodeId}`,
            `Size: ${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
            `Z: ${node.availableZ.join(", ")}`,
            candidate ? `g: ${candidate.g.toFixed(2)}` : "",
            candidate ? `h: ${candidate.h.toFixed(2)}` : "",
            candidate ? `f: ${candidate.f.toFixed(2)}` : "",
            node._containsTarget ? "TARGET" : "",
            node._containsObstacle ? "OBSTACLE" : "",
          ]
            .filter((s) => s)
            .join("\n"),
        })
      }
    }

    // 2. Visualize ALL edges as light gray lines
    for (const edge of this.edges) {
      const [id1, id2] = edge.nodeIds
      const node1 = this.nodeMap.get(id1)
      const node2 = this.nodeMap.get(id2)
      if (
        node1?.center &&
        node2?.center &&
        isValidPoint(node1.center) &&
        isValidPoint(node2.center)
      ) {
        graphics.lines!.push({
          points: [node1.center, node2.center],
          strokeColor: "rgba(150, 150, 150, 0.2)",
        })
      }
    }

    // 3. Visualize all solved routes as lines between each node
    for (let i = 0; i < this.solvedRoutes.length; i++) {
      const solvedRoute = this.solvedRoutes[i]
      const path = solvedRoute.path
      const color = "blue"

      for (let j = 0; j < path.length - 1; j++) {
        const node1 = path[j]
        const node2 = path[j + 1]
        if (
          node1?.center &&
          node2?.center &&
          isValidPoint(node1.center) &&
          isValidPoint(node2.center)
        ) {
          // Check if both nodes are on z=1
          const bothOnZ1 =
            node1.availableZ.includes(1) && node2.availableZ.includes(1)

          // Add slight offset to show overlapping routes
          const offset = (i % 5) * 0.02
          graphics.lines!.push({
            points: [
              { x: node1.center.x + offset, y: node1.center.y + offset },
              { x: node2.center.x + offset, y: node2.center.y + offset },
            ],
            strokeColor: color,
            strokeDash: bothOnZ1 ? "5 5" : undefined,
          })
        }
      }

      // Mark route endpoints with labeled points
      if (path.length > 0) {
        const startNode = path[0]
        const endNode = path[path.length - 1]
        if (startNode?.center && isValidPoint(startNode.center)) {
          graphics.points!.push({
            x: startNode.center.x,
            y: startNode.center.y,
            label: `START: ${solvedRoute.connection.name}`,
          })
        }
        if (endNode?.center && isValidPoint(endNode.center)) {
          graphics.points!.push({
            x: endNode.center.x,
            y: endNode.center.y,
            label: `END: ${solvedRoute.connection.name}`,
          })
        }
      }
    }

    // 4. Visualize solved subpaths in green
    if (this.solvedSubpaths) {
      for (let i = 0; i < this.solvedSubpaths.length; i++) {
        const subpath = this.solvedSubpaths[i]
        if (subpath.path && subpath.path.length > 1) {
          for (let j = 0; j < subpath.path.length - 1; j++) {
            const node1 = subpath.path[j]
            const node2 = subpath.path[j + 1]
            if (
              node1?.center &&
              node2?.center &&
              isValidPoint(node1.center) &&
              isValidPoint(node2.center)
            ) {
              graphics.lines!.push({
                points: [node1.center, node2.center],
                strokeColor: "green",
                strokeDash: subpath.layer === 1 ? "3 3" : undefined,
              })
            }
          }
        }
      }
    }

    // 5. Visualize current active subpath with thick orange line
    if (this.activeSubpath) {
      const start = this.activeSubpath.start?.center
      const end = this.activeSubpath.end?.center
      if (start && end && isValidPoint(start) && isValidPoint(end)) {
        graphics.lines!.push({
          points: [start, end],
          strokeColor: "orange",
          strokeDash: "5 5",
        })
        graphics.points!.push({
          x: start.x,
          y: start.y,
          label: "ACTIVE START",
        })
        graphics.points!.push({
          x: end.x,
          y: end.y,
          label: "ACTIVE END",
        })
      }
    }

    // 6. Visualize top 10 candidate paths with decreasing opacity
    const topCandidates = this.queuedCandidateNodes
      .slice(0, 10)
      .sort((a, b) => a.f - b.f)
    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i]
      const opacity = 0.6 * (1 - i / 10)

      // Backtrace the path
      const path: CapacityMeshNode[] = []
      let current: Candidate | null = candidate
      while (current) {
        path.push(current.node)
        current = current.prevCandidate
      }
      path.reverse()

      if (path.length > 1) {
        const points = path.map((n) => n.center).filter((p) => isValidPoint(p))
        if (points.length > 1) {
          graphics.lines!.push({
            points,
            strokeColor: safeTransparentize("purple", 1 - opacity),
            strokeDash: this.activeSubpath?.layer === 1 ? "4 2" : undefined,
          })
        }
      }
    }

    // 7. Visualize active connection pair (if any)
    if (this.activeConnectionPair) {
      const start = this.activeConnectionPair.start?.center
      const end = this.activeConnectionPair.end?.center
      if (start && end && isValidPoint(start) && isValidPoint(end)) {
        graphics.lines!.push({
          points: [start, end],
          strokeColor: "cyan",
          strokeDash: "20 5",
        })
      }
    }

    // 8. Visualize directive vias (if using directive strategy)
    if (this.ogUnprocessedSubpaths && this.ogUnprocessedSubpaths.length === 3) {
      const [, mid] = this.ogUnprocessedSubpaths
      if (mid.start?.center && isValidPoint(mid.start.center)) {
        const radius = Math.max(mid.start.width || 0, mid.start.height || 0)
        if (isValidNumber(radius) && radius > 0) {
          graphics.circles!.push({
            center: mid.start.center,
            radius: radius,
            stroke: "blue",
          })
          graphics.points!.push({
            x: mid.start.center.x,
            y: mid.start.center.y,
            label: "DIRECTIVE VIA 1",
          })
        }
      }
      if (mid.end?.center && isValidPoint(mid.end.center)) {
        const radius = Math.max(mid.end.width || 0, mid.end.height || 0)
        if (isValidNumber(radius) && radius > 0) {
          graphics.circles!.push({
            center: mid.end.center,
            radius: radius,
            stroke: "purple",
          })
          graphics.points!.push({
            x: mid.end.center.x,
            y: mid.end.center.y,
            label: "DIRECTIVE VIA 2",
          })
        }
      }
    }

    // 9. Visualize candidate nodes with small circles
    if (this.queuedCandidateNodes.length > 0) {
      for (const candidate of this.queuedCandidateNodes) {
        const node = candidate.node
        if (node?.center && isValidPoint(node.center)) {
          graphics.circles!.push({
            center: node.center,
            radius: 0.05,
            fill: "rgba(255, 255, 0, 0.6)",
            stroke: "yellow",
          })
        }
      }
    }

    // 10. Visualize visited nodes with gray circles
    if (this.visitedNodes.size > 0) {
      for (const nodeId of this.visitedNodes) {
        const node = this.nodeMap.get(nodeId)
        if (node?.center && isValidPoint(node.center)) {
          graphics.circles!.push({
            center: node.center,
            radius: 0.08,
            fill: "rgba(128, 128, 128, 0.5)",
            stroke: "gray",
          })
        }
      }
    }

    return graphics
  }
}

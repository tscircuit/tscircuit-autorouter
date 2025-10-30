import { CapacityPathingGreedySolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingGreedySolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
  SimpleRouteJson,
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

  unprocessedSubpaths: SubpathNodePair[] | null = null
  solvedSubpaths: SubpathNodePair[] | null = null

  activeSubpath: SubpathNodePair | null = null

  viaNodes: CapacityMeshNode[] = []

  constructor({
    simpleRouteJson,
    nodes,
    edges,
    colorMap,
    MAX_ITERATIONS = 1e6,
    hyperParameters = {},
  }: {
    simpleRouteJson: SimpleRouteJson
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    colorMap?: Record<string, string>
    MAX_ITERATIONS?: number
    hyperParameters?: Partial<CapacityHyperParameters>
  }) {
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

    this.unprocessedConnectionPairs = cloneAndShuffleArray(
      this.simpleRouteJson.connections.map((conn) => {
        const startNode = this.nodes.find(
          (n) => n._targetConnectionName === conn.name,
        )!
        const endNode = this.nodes.find(
          (n) => n._targetConnectionName === conn.name,
        )!
        if (!startNode || !endNode) {
          throw new Error(
            `Could not find start or end node for connection "${conn.name}"`,
          )
        }
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

  lastStepOperation:
    | "none"
    | "dequeueConnectionPair"
    | "breakConnectionPairIntoSubpaths"
    | "dequeueSubpath"
    | "stepSolveSubpath"
    | "finishedSolvingSubpath"
    | "finishedSolvingConnectionPair" = "none"

  _step() {
    if (!this.activeConnectionPair) {
      this.activeConnectionPair = this.unprocessedConnectionPairs.shift()!
      if (!this.activeConnectionPair) {
        this.solved = true
        return
      }
      this.lastStepOperation = "dequeueConnectionPair"
      return
    }

    if (this.activeConnectionPair && !this.unprocessedSubpaths) {
      this.unprocessedSubpaths = this.breakConnectionPairIntoSubpaths(
        this.activeConnectionPair,
      )
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
      // Backtrack and mark the path's nodes as used
      let walk: Candidate | null = current
      while (walk) {
        this.usedNodeMap.set(walk.node.capacityMeshNodeId, true)
        walk = walk.prevCandidate
      }
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

    // Filter out hard obstacles (non-traversable)
    return Array.from(neighbors).filter(
      (n) => !n._completelyInsideObstacle && !n._containsObstacle,
    )
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
    let g = prevCandidate.g + step

    // Turning penalty to encourage straighter segments
    const pp = prevCandidate.prevCandidate?.node
    if (pp) {
      const v1x = prevCandidate.node.center.x - pp.center.x
      const v1y = prevCandidate.node.center.y - pp.center.y
      const v2x = node.center.x - prevCandidate.node.center.x
      const v2y = node.center.y - prevCandidate.node.center.y
      const l1 = Math.hypot(v1x, v1y) || 1
      const l2 = Math.hypot(v2x, v2y) || 1
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2)
      const clamped = Math.max(-1, Math.min(1, dot))
      const angle = Math.acos(clamped) // 0 (straight) .. π (U-turn)
      // modest turn cost, scaled by move length
      g += 0.15 * angle * step
    }

    // Strongly discourage reusing nodes already part of prior paths
    if (this.usedNodeMap.has(node.capacityMeshNodeId)) {
      g += 1e6
    }

    // Mild penalty for changing layers (if layers are meaningful here)
    try {
      const zPrev = mapLayerNameToZ(
        prevCandidate.node.layer,
        this.simpleRouteJson.layerCount,
      )
      const zNode = mapLayerNameToZ(node.layer, this.simpleRouteJson.layerCount)
      if (zPrev !== zNode) g += 100
    } catch {
      // mapLayerNameToZ may throw or be undefined for custom layers — ignore
    }

    return g
  }

  computeH(
    _prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    // Straight-line heuristic to the goal
    let h = this._dist(node, endGoal)

    // Prefer being on the same layer as the goal, when layers are meaningful
    try {
      const zNode = mapLayerNameToZ(node.layer, this.simpleRouteJson.layerCount)
      const zGoal = mapLayerNameToZ(
        endGoal.layer,
        this.simpleRouteJson.layerCount,
      )
      const dz = Math.abs(zNode - zGoal)
      if (dz > 0) h += 50 * dz
    } catch {
      // ignore layer heuristic if mapping is unknown
    }

    // Slight nudge away from already-used nodes
    if (this.usedNodeMap.has(node.capacityMeshNodeId)) {
      h += 100
    }

    return h
  }

  createSolvedRoute(
    subpaths: SubpathNodePair[],
    connectionPair: ConnectionNodePair,
  ): ConnectionPathWithNodes {
    return {
      connection: connectionPair.connection,
      path: subpaths
        .map((subpath) => subpath.start)
        .concat(subpaths[subpaths.length - 1].end),
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
      return [
        {
          start: connectionPair.start,
          end: connectionPair.end,
          solved: false,
        },
      ]
    }

    // Choose directive vias
    const closestVia = this.getClosestVia(connectionPair.start)
    const farVia = this.getFarVia(closestVia, connectionPair.end)

    const subpaths: SubpathNodePair[] = []
    subpaths.push({
      start: connectionPair.start,
      end: closestVia,
      solved: false,
    })
    subpaths.push({
      start: closestVia,
      end: farVia,
      solved: false,
    })
    subpaths.push({
      start: farVia,
      end: connectionPair.end,
      solved: false,
    })
    return subpaths
  }

  getClosestVia(node: CapacityMeshNode): CapacityMeshNode {
    if (this.viaNodes.length === 0) return node
    // Exclude blocked vias
    const candidates = this.viaNodes.filter(
      (v) => !v._completelyInsideObstacle && !v._containsObstacle,
    )
    if (candidates.length === 0) return node
    candidates.sort((a, b) => this._dist(a, node) - this._dist(b, node))
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

    const viable = this.viaNodes.filter(
      (v) =>
        v.capacityMeshNodeId !== closestVia.capacityMeshNodeId &&
        !v._completelyInsideObstacle &&
        !v._containsObstacle &&
        this._dist(v, closestVia) >= minD,
    )

    if (viable.length === 0) {
      // Fall back: farthest available via from the first via (still avoiding obstacles)
      const fallback = this.viaNodes
        .filter(
          (v) =>
            v.capacityMeshNodeId !== closestVia.capacityMeshNodeId &&
            !v._completelyInsideObstacle &&
            !v._containsObstacle,
        )
        .sort(
          (a, b) => this._dist(b, closestVia) - this._dist(a, closestVia),
        )[0]
      return fallback ?? closestVia
    }

    // Minimize weighted sum: distance from closestVia + distance to goal
    // (staying at least FAR_VIA_MIN_DISTANCE away from closestVia)
    viable.sort((a, b) => {
      const sa = this._dist(a, closestVia) + this._dist(a, end)
      const sb = this._dist(b, closestVia) + this._dist(b, end)
      if (sa !== sb) return sa - sb
      // tie-break: closer to goal
      return this._dist(a, end) - this._dist(b, end)
    })
    return viable[0]
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
      const isUsed = this.usedNodeMap.has(node.capacityMeshNodeId)
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
          fill: isUsed
            ? "rgba(0, 255, 0, 0.3)"
            : isInCandidates
              ? "rgba(255, 255, 0, 0.2)"
              : node._containsTarget
                ? "rgba(0, 150, 255, 0.15)"
                : node._containsObstacle
                  ? "rgba(255, 0, 0, 0.1)"
                  : "rgba(200, 200, 200, 0.05)",
          stroke: isUsed ? "green" : undefined,
          label: [
            `ID: ${node.capacityMeshNodeId}`,
            `Size: ${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
            `Z: ${node.availableZ.join(", ")}`,
            candidate ? `g: ${candidate.g.toFixed(2)}` : "",
            candidate ? `h: ${candidate.h.toFixed(2)}` : "",
            candidate ? `f: ${candidate.f.toFixed(2)}` : "",
            isUsed ? "USED" : "",
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

    // 3. Visualize all solved routes as thick colored lines
    for (let i = 0; i < this.solvedRoutes.length; i++) {
      const solvedRoute = this.solvedRoutes[i]
      const path = solvedRoute.path
      const color = this.colorMap[solvedRoute.connection.name] || "green"

      for (let j = 0; j < path.length - 1; j++) {
        const node1 = path[j]
        const node2 = path[j + 1]
        if (
          node1?.center &&
          node2?.center &&
          isValidPoint(node1.center) &&
          isValidPoint(node2.center)
        ) {
          // Add slight offset to show overlapping routes
          const offset = (i % 5) * 0.02
          graphics.lines!.push({
            points: [
              { x: node1.center.x + offset, y: node1.center.y + offset },
              { x: node2.center.x + offset, y: node2.center.y + offset },
            ],
            strokeColor: color,
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

    // 4. Visualize current active subpath with thick orange line
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

    // 5. Visualize top 10 candidate paths with decreasing opacity
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
            strokeColor: safeTransparentize("yellow", 1 - opacity),
          })
        }
      }
    }

    // 6. Visualize active connection pair (if any)
    if (this.activeConnectionPair) {
      const start = this.activeConnectionPair.start?.center
      const end = this.activeConnectionPair.end?.center
      if (start && end && isValidPoint(start) && isValidPoint(end)) {
        graphics.lines!.push({
          points: [start, end],
          strokeColor: "red",
          strokeDash: "10 5",
        })
      }
    }

    // 7. Visualize directive vias (if using directive strategy)
    if (this.unprocessedSubpaths && this.unprocessedSubpaths.length === 3) {
      const [, mid] = this.unprocessedSubpaths
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

    // 8. Visualize visited nodes (if active)
    if (this.visitedNodes.size > 0) {
      for (const nodeId of this.visitedNodes) {
        const node = this.nodeMap.get(nodeId)
        if (node?.center && isValidPoint(node.center)) {
          graphics.circles!.push({
            center: node.center,
            radius: 0.08,
            fill: "rgba(100, 100, 255, 0.4)",
          })
        }
      }
    }

    return graphics
  }
}

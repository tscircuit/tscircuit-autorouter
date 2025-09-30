import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  CapacityPath,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../../types"
import { getNodeEdgeMap } from "../CapacityMeshSolver/getNodeEdgeMap"
import { distance } from "@tscircuit/math-utils"
import { CapacityHyperParameters } from "../CapacityHyperParameters"
import { GraphicsObject } from "graphics-debug"
import { safeTransparentize } from "../colors"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

export type Candidate = {
  prevCandidate: Candidate | null
  node: CapacityMeshNode
  f: number
  g: number
  h: number
}

export type ConnectionPathWithNodes = {
  connection: SimpleRouteConnection
  nodes: CapacityMeshNode[]
  path?: CapacityMeshNode[]
  straightLineDistance: number
}

export class CapacityPathingSolver extends BaseSolver {
  connectionsWithNodes: Array<ConnectionPathWithNodes>

  usedNodeCapacityMap: Map<CapacityMeshNodeId, number>

  simpleRouteJson: SimpleRouteJson
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  GREEDY_MULTIPLIER = 1.1
  MAX_CANDIDATES_IN_MEMORY = 10_000

  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>
  colorMap: Record<string, string>
  maxDepthOfNodes: number

  activeCandidateStraightLineDistance?: number

  debug_lastNodeCostMap: Map<
    CapacityMeshNodeId,
    {
      g: number
      h: number
      f: number
    }
  >

  hyperParameters: Partial<CapacityHyperParameters>

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
    this.MAX_ITERATIONS = MAX_ITERATIONS
    this.simpleRouteJson = simpleRouteJson
    this.nodes = nodes
    this.edges = edges
    this.colorMap = colorMap ?? {}
    const { connectionsWithNodes, connectionNameToGoalNodeIds } =
      this.getConnectionsWithNodes()
    this.connectionsWithNodes = connectionsWithNodes
    this.connectionNameToGoalNodeIds = connectionNameToGoalNodeIds
    this.hyperParameters = hyperParameters
    this.usedNodeCapacityMap = new Map(
      this.nodes.map((node) => [node.capacityMeshNodeId, 0]),
    )
    this.nodeMap = new Map(
      this.nodes.map((node) => [node.capacityMeshNodeId, node]),
    )
    this.nodeEdgeMap = getNodeEdgeMap(this.edges)
    this.maxDepthOfNodes = Math.max(
      ...this.nodes.map((node) => node._depth ?? 0),
    )
    this.debug_lastNodeCostMap = new Map()
  }

  getTotalCapacity(node: CapacityMeshNode): number {
    const depth = node._depth ?? 0
    return (this.maxDepthOfNodes - depth + 1) ** 2
  }

  getConnectionsWithNodes() {
    const connectionsWithNodes: Array<{
      connection: SimpleRouteConnection
      nodes: CapacityMeshNode[]
      pathFound: boolean
      straightLineDistance: number
    }> = []
    const nodesWithTargets = this.nodes.filter((node) => node._containsTarget)
    const connectionNameToGoalNodeIds = new Map<string, CapacityMeshNodeId[]>()

    for (const connection of this.simpleRouteJson.connections) {
      const nodesForConnection: CapacityMeshNode[] = []
      for (const point of connection.pointsToConnect) {
        let closestNode = this.nodes[0]
        let minDistance = Number.MAX_VALUE

        for (const node of nodesWithTargets) {
          const distance = Math.sqrt(
            (node.center.x - point.x) ** 2 + (node.center.y - point.y) ** 2,
          )
          if (distance < minDistance) {
            minDistance = distance
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
      connectionsWithNodes.push({
        connection,
        nodes: nodesForConnection,
        pathFound: false,
        straightLineDistance: distance(
          nodesForConnection[0].center,
          nodesForConnection[nodesForConnection.length - 1].center,
        ),
      })
    }

    connectionsWithNodes.sort(
      (a, b) => a.straightLineDistance - b.straightLineDistance,
    )
    return { connectionsWithNodes, connectionNameToGoalNodeIds }
  }

  currentConnectionIndex = 0

  candidates?: Array<Candidate> | null
  visitedNodes?: Set<CapacityMeshNodeId> | null

  computeG(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    return (
      prevCandidate.g + this.getDistanceBetweenNodes(prevCandidate.node, node)
    )
  }

  computeH(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    return this.getDistanceBetweenNodes(node, endGoal)
  }

  getBacktrackedPath(candidate: Candidate) {
    const path: CapacityMeshNode[] = []
    let currentCandidate = candidate
    while (currentCandidate) {
      path.push(currentCandidate.node)
      currentCandidate = currentCandidate.prevCandidate!
    }
    return path
  }

  getNeighboringNodes(node: CapacityMeshNode) {
    return this.nodeEdgeMap
      .get(node.capacityMeshNodeId)!
      .flatMap((edge): CapacityMeshNodeId[] =>
        edge.nodeIds.filter((n) => n !== node.capacityMeshNodeId),
      )
      .map((n) => this.nodeMap.get(n)!)
  }

  getCapacityPaths() {
    const capacityPaths: CapacityPath[] = []
    for (const connection of this.connectionsWithNodes) {
      const path = connection.path
      if (path) {
        capacityPaths.push({
          capacityPathId: connection.connection.name,
          connectionName: connection.connection.name,
          nodeIds: path.map((node) => node.capacityMeshNodeId),
        })
      }
    }
    return capacityPaths
  }

  doesNodeHaveCapacityForTrace(
    node: CapacityMeshNode,
    prevNode: CapacityMeshNode,
  ) {
    const usedCapacity =
      this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
    const totalCapacity = this.getTotalCapacity(node)

    // Single layer nodes can't safely have multiple traces because there's no
    // way to cross over two traces without a via
    if (
      node.availableZ.length === 1 &&
      !node._containsTarget &&
      usedCapacity > 0
    )
      return false

    let additionalCapacityRequirement = 0
    if (node.availableZ.length > 1 && prevNode.availableZ.length === 1) {
      additionalCapacityRequirement += 0.5
    }

    return usedCapacity + additionalCapacityRequirement < totalCapacity
  }

  canTravelThroughObstacle(node: CapacityMeshNode, connectionName: string) {
    const goalNodeIds = this.connectionNameToGoalNodeIds.get(connectionName)

    return goalNodeIds?.includes(node.capacityMeshNodeId) ?? false
  }

  getDistanceBetweenNodes(A: CapacityMeshNode, B: CapacityMeshNode) {
    return Math.sqrt(
      (A.center.x - B.center.x) ** 2 + (A.center.y - B.center.y) ** 2,
    )
  }

  reduceCapacityAlongPath(nextConnection: { path?: CapacityMeshNode[] }) {
    for (const node of nextConnection.path ?? []) {
      this.usedNodeCapacityMap.set(
        node.capacityMeshNodeId,
        this.usedNodeCapacityMap.get(node.capacityMeshNodeId)! + 1,
      )
    }
  }

  isConnectedToEndGoal(node: CapacityMeshNode, endGoal: CapacityMeshNode) {
    return this.nodeEdgeMap
      .get(node.capacityMeshNodeId)!
      .some((edge) => edge.nodeIds.includes(endGoal.capacityMeshNodeId))
  }

  _step() {
    const nextConnection =
      this.connectionsWithNodes[this.currentConnectionIndex]
    if (!nextConnection) {
      this.solved = true
      return
    }
    const [start, end] = nextConnection.nodes
    if (!this.candidates) {
      this.candidates = [{ prevCandidate: null, node: start, f: 0, g: 0, h: 0 }]
      this.debug_lastNodeCostMap = new Map()
      this.visitedNodes = new Set([start.capacityMeshNodeId])
      this.activeCandidateStraightLineDistance = distance(
        start.center,
        end.center,
      )
    }

    this.candidates.sort((a, b) => a.f - b.f)
    const currentCandidate = this.candidates.shift()
    if (this.candidates.length > this.MAX_CANDIDATES_IN_MEMORY) {
      this.candidates.splice(
        this.MAX_CANDIDATES_IN_MEMORY,
        this.candidates.length - this.MAX_CANDIDATES_IN_MEMORY,
      )
    }
    if (!currentCandidate) {
      // TODO Track failed paths, make sure solver doesn't think it solved
      console.error(
        `Ran out of candidates on connection ${nextConnection.connection.name}`,
      )
      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      this.failed = true
      return
    }
    if (this.isConnectedToEndGoal(currentCandidate.node, end)) {
      nextConnection.path = this.getBacktrackedPath({
        prevCandidate: currentCandidate,
        node: end,
        f: 0,
        g: 0,
        h: 0,
      })

      this.reduceCapacityAlongPath(nextConnection)

      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      return
    }

    const neighborNodes = this.getNeighboringNodes(currentCandidate.node)
    for (const neighborNode of neighborNodes) {
      if (this.visitedNodes?.has(neighborNode.capacityMeshNodeId)) {
        continue
      }
      if (
        !this.doesNodeHaveCapacityForTrace(neighborNode, currentCandidate.node)
      ) {
        continue
      }
      const connectionName =
        this.connectionsWithNodes[this.currentConnectionIndex].connection.name
      if (
        neighborNode._containsObstacle &&
        !this.canTravelThroughObstacle(neighborNode, connectionName)
      ) {
        continue
      }
      const g = this.computeG(currentCandidate, neighborNode, end)
      const h = this.computeH(currentCandidate, neighborNode, end)
      const f = g + h * this.GREEDY_MULTIPLIER

      this.debug_lastNodeCostMap.set(neighborNode.capacityMeshNodeId, {
        f,
        g,
        h,
      })

      const newCandidate = {
        prevCandidate: currentCandidate,
        node: neighborNode,
        f,
        g,
        h,
      }
      this.candidates.push(newCandidate)
    }
    this.visitedNodes!.add(currentCandidate.node.capacityMeshNodeId)
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Visualize each solved connection path (draw a line through each node's center)
    if (this.connectionsWithNodes) {
      for (let i = 0; i < this.connectionsWithNodes.length; i++) {
        const conn = this.connectionsWithNodes[i]
        if (conn.path && conn.path.length > 0) {
          const pathPoints = conn.path.map(
            ({ center: { x, y }, width, availableZ }) => ({
              // slight offset to allow viewing overlapping paths
              x: x + ((i % 10) + (i % 19)) * (0.005 * width),
              y: y + ((i % 10) + (i % 19)) * (0.005 * width),
              availableZ,
            }),
          )
          graphics.lines!.push({
            points: pathPoints,
            strokeColor: this.colorMap[conn.connection.name],
          })
          for (let u = 0; u < pathPoints.length; u++) {
            const point = pathPoints[u]
            graphics.points!.push({
              x: point.x,
              y: point.y,
              label: [
                `conn: ${conn.connection.name}`,
                `node: ${conn.path[u].capacityMeshNodeId}`,
                `z: ${point.availableZ.join(",")}`,
              ].join("\n"),
            })
          }
        }
      }
    }

    for (const node of this.nodes) {
      const usedCapacity =
        this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
      const totalCapacity = this.getTotalCapacity(node)
      const nodeCosts = this.debug_lastNodeCostMap.get(node.capacityMeshNodeId)
      graphics.rects!.push({
        ...createRectFromCapacityNode(node, {
          rectMargin: 0.025,
          zOffset: 0.01,
        }),
        label: [
          `${node.capacityMeshNodeId}`,
          `${usedCapacity}/${totalCapacity}`,
          `${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
          `g: ${nodeCosts?.g !== undefined ? nodeCosts.g.toFixed(2) : "?"}`,
          `h: ${nodeCosts?.h !== undefined ? nodeCosts.h.toFixed(2) : "?"}`,
          `f: ${nodeCosts?.f !== undefined ? nodeCosts.f.toFixed(2) : "?"}`,
          `z: ${node.availableZ.join(", ")}`,
        ].join("\n"),
        stroke: usedCapacity > totalCapacity + 0.5 ? "red" : undefined,
      })
    }

    // Visualize connection points from each connection as circles
    if (this.connectionsWithNodes) {
      for (const conn of this.connectionsWithNodes) {
        if (conn.connection?.pointsToConnect) {
          for (const point of conn.connection.pointsToConnect) {
            graphics.points!.push({
              x: point.x,
              y: point.y,
              label: [`pointsToConnect ${conn.connection.name}`].join("\n"),
            })
          }
        }
      }
    }

    // Draw a dashed line from the start node to the end node
    const nextConnection =
      this.connectionsWithNodes[this.currentConnectionIndex]

    // If we failed on the previous connection and haven't started the next one yet,
    // show the failed connection instead
    let connectionToVisualize = nextConnection
    if (
      !this.candidates &&
      this.currentConnectionIndex > 0 &&
      !this.connectionsWithNodes[this.currentConnectionIndex - 1].path
    ) {
      connectionToVisualize =
        this.connectionsWithNodes[this.currentConnectionIndex - 1]
    }

    if (connectionToVisualize) {
      const [start, end] = connectionToVisualize.connection.pointsToConnect
      graphics.lines!.push({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor: "red",
        strokeDash: "10 5",
      })
    }

    // Visualize backtracked path of highest ranked candidate
    if (this.candidates) {
      // Get top 10 candidates
      const topCandidates = this.candidates.slice(0, 5)
      const connectionName =
        this.connectionsWithNodes[this.currentConnectionIndex].connection.name

      // Add paths for each candidate with decreasing opacity
      topCandidates.forEach((candidate, index) => {
        const opacity = 0.5 * (1 - index / 5) // Opacity decreases from 0.5 to 0.05
        const backtrackedPath = this.getBacktrackedPath(candidate)
        graphics.lines!.push({
          points: backtrackedPath.map(({ center: { x, y } }) => ({ x, y })),
          strokeColor: safeTransparentize(
            this.colorMap[connectionName] ?? "red",
            1 - opacity,
          ),
        })
      })
    }

    return graphics
  }
}

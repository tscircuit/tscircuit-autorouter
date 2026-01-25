import {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"
import { safeTransparentize } from "../colors"

export class DeadEndSolver extends BaseSolver {
  override getSolverName(): string {
    return "DeadEndSolver"
  }

  public removedNodeIds: Set<string>

  private targetNodeIds: Set<string>
  private leaves: string[]
  private leavesIndex: number
  private adjacencyList: Map<string, Set<string>>

  /** Only used for visualization, dynamically instantiated if necessary */
  nodeMap?: Map<CapacityMeshNodeId, CapacityMeshNode>

  // Store the nodes and edges just for visualization purposes
  private nodes: CapacityMeshNode[]
  private edges: CapacityMeshEdge[]

  constructor({
    nodes,
    edges,
  }: {
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
  }) {
    super()

    this.MAX_ITERATIONS = nodes.length

    this.nodes = nodes
    this.edges = edges

    this.removedNodeIds = new Set()

    this.targetNodeIds = new Set(
      nodes.filter((n) => n._containsTarget).map((n) => n.capacityMeshNodeId),
    )

    this.adjacencyList = new Map(
      nodes.map(({ capacityMeshNodeId }) => [capacityMeshNodeId, new Set()]),
    )

    // Build an adjacency list based on the edges
    for (const {
      nodeIds: [u, v],
    } of edges) {
      this.adjacencyList.get(u)!.add(v)
      this.adjacencyList.get(v)!.add(u)
    }

    // Determine all nodes that have only a single link (leaves of a tree) and
    //  are not a target.
    this.leavesIndex = 0
    this.leaves = [...this.adjacencyList.entries()]
      .filter(([_, neighbours]) => neighbours.size === 1)
      .filter(([nodeId, _]) => !this.targetNodeIds.has(nodeId))
      .map(([nodeId, _]) => nodeId)
  }

  _step() {
    if (this.leavesIndex === this.leaves.length) {
      this.solved = true
      return
    }

    const leaf = this.leaves[this.leavesIndex]

    const leafNeighbors = this.adjacencyList.get(leaf)

    if (!leafNeighbors || leafNeighbors.size === 0) {
      this.removedNodeIds.add(leaf)
      this.adjacencyList.delete(leaf)
      this.leavesIndex += 1
      if (this.leavesIndex === this.leaves.length) {
        this.solved = true
      }
      return
    }

    // Get the single neighbor of the leaf node
    const [neighbor] = leafNeighbors

    const neighborsOfLeafNeighbor = neighbor
      ? this.adjacencyList.get(neighbor)
      : undefined

    if (!neighbor || !neighborsOfLeafNeighbor) {
      this.removedNodeIds.add(leaf)
      this.adjacencyList.delete(leaf)
      this.leavesIndex += 1
      if (this.leavesIndex === this.leaves.length) {
        this.solved = true
      }
      return
    }

    // Remove the leaf from the adjacency list of the neighbor of the leaf.
    // This is, by definition, the only entry in the adjacency map that links
    // to the leaf. Hence, there is no other reference to the leaf and it will
    // never be visited again.
    neighborsOfLeafNeighbor.delete(leaf)

    // Add the leaf to the list of removed ids
    this.removedNodeIds.add(leaf)

    // Remove the leaf entry entirely so that we never try to process it again
    this.adjacencyList.delete(leaf)

    // Check if the neighbour of the leaf has now become a leaf such that it can
    // be removed in a future iteration.
    if (
      neighborsOfLeafNeighbor.size === 1 &&
      !this.targetNodeIds.has(neighbor)
    ) {
      this.leaves.push(neighbor)
    }

    this.leavesIndex += 1

    if (this.leavesIndex === this.leaves.length) {
      this.solved = true
    }
  }

  visualize(): GraphicsObject {
    if (!this.nodeMap) {
      this.nodeMap = new Map<CapacityMeshNodeId, CapacityMeshNode>()
      for (const node of this.nodes) {
        this.nodeMap.set(node.capacityMeshNodeId, node)
      }
    }

    const edgeCount = new Map<string, number>()

    for (const edge of this.edges) {
      for (const nodeId of edge.nodeIds) {
        edgeCount.set(nodeId, 1 + (edgeCount.get(nodeId) ?? 0))
      }
    }

    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: this.nodes.map((node) => {
        const lowestZ = Math.min(...node.availableZ)
        return {
          width: Math.max(node.width - 2, node.width * 0.8),
          height: Math.max(node.height - 2, node.height * 0.8),
          center: {
            x: node.center.x + lowestZ * node.width * 0.05,
            y: node.center.y - lowestZ * node.width * 0.05,
          },
          fill: node._containsObstacle
            ? "rgba(255,0,0,0.1)"
            : ({
                "0,1": "rgba(0,0,0,0.1)",
                "0": "rgba(0,200,200, 0.1)",
                "1": "rgba(0,0,200, 0.1)",
              }[node.availableZ.join(",")] ?? "rgba(0,200,200,0.1)"),
          label: [
            node.capacityMeshNodeId,
            `availableZ: ${node.availableZ.join(",")}`,
            `target? ${node._containsTarget ?? false}`,
            `obs? ${node._containsObstacle ?? false}`,
            `conn: ${edgeCount.get(node.capacityMeshNodeId) ?? 0}`,
          ].join("\n"),
          layer: `z${node.availableZ.join(",")}`,
        }
      }),
      circles: [],
    }

    for (const edge of this.edges) {
      const node1 = this.nodeMap.get(edge.nodeIds[0])
      const node2 = this.nodeMap.get(edge.nodeIds[1])
      if (node1?.center && node2?.center) {
        const lowestZ1 = Math.min(...node1.availableZ)
        const lowestZ2 = Math.min(...node2.availableZ)
        const nodeCenter1Adj = {
          x: node1.center.x + lowestZ1 * node1.width * 0.05,
          y: node1.center.y - lowestZ1 * node1.width * 0.05,
        }
        const nodeCenter2Adj = {
          x: node2.center.x + lowestZ2 * node2.width * 0.05,
          y: node2.center.y - lowestZ2 * node2.width * 0.05,
        }

        const availableZ = Array.from(
          new Set([...node1.availableZ, ...node2.availableZ]),
        ).sort()

        graphics.lines!.push({
          layer: `z${availableZ.join(",")}`,
          points: [nodeCenter1Adj, nodeCenter2Adj],
          strokeDash:
            node1.availableZ.join(",") === node2.availableZ.join(",")
              ? undefined
              : "10 5",
          strokeColor: edge.nodeIds.some((nodeId) =>
            this.removedNodeIds.has(nodeId),
          )
            ? safeTransparentize("black", 0.9)
            : undefined,
        })
      }
    }
    return graphics
  }
}

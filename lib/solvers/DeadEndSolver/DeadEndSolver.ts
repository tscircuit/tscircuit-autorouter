import { CapacityMeshEdge, CapacityMeshNode } from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"

export class DeadEndSolver extends BaseSolver {
  public removedNodeIds: Set<string>

  private targetNodeIds: Set<string>
  private leaves: string[]
  private leavesIndex: number
  private adjacencyList: Map<string, Set<string>>

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

    // Get the single neighbor of the leaf node
    const [neighbor] = this.adjacencyList.get(leaf)!

    const neighborsOfLeafNeighbor = this.adjacencyList.get(neighbor)!

    // Remove the leaf from the adjacency list of the neighbor of the leaf.
    // This is, by definition, the only entry in the adjacency map that links
    // to the leaf. Hence, there is no other reference to the leaf and it will
    // never be visited again.
    neighborsOfLeafNeighbor.delete(leaf)

    // Add the leaf to the list of removed ids
    this.removedNodeIds.add(leaf)

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
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    for (const edge of this.edges) {
      if (!edge.nodeIds.some((nodeId) => this.removedNodeIds.has(nodeId))) {
        continue
      }

      const [node1, node2] = edge.nodeIds.map((nodeId) => {
        return this.nodes.find((node) => node.capacityMeshNodeId === nodeId)
      })

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
        graphics.lines!.push({
          strokeColor: "black",
          points: [nodeCenter1Adj, nodeCenter2Adj],
        })
      }
    }
    return graphics
  }
}

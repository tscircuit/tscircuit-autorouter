import Flatbush from "flatbush"
import type { CapacityMeshNode } from "../../types/capacity-mesh-types"
import {
  areNodesBordering,
  CAPACITY_NODE_BORDERING_EPSILON,
} from "../../utils/areNodesBordering"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"

/** Builds each undirected capacity-mesh adjacency exactly once. */
export class CapacityMeshEdgeSolver3_Flatbush extends CapacityMeshEdgeSolver {
  private readonly nodeIndex?: Flatbush
  private currentNodeIndex = 0

  override getSolverName(): string {
    return "CapacityMeshEdgeSolver3_Flatbush"
  }

  constructor(nodes: CapacityMeshNode[]) {
    super(nodes)
    this.MAX_ITERATIONS = nodes.length + 1

    if (nodes.length === 0) return

    this.nodeIndex = new Flatbush(nodes.length)
    for (const node of nodes) {
      this.nodeIndex.add(
        node.center.x - node.width / 2,
        node.center.y - node.height / 2,
        node.center.x + node.width / 2,
        node.center.y + node.height / 2,
      )
    }
    this.nodeIndex.finish()
  }

  override _step(): void {
    if (this.currentNodeIndex >= this.nodes.length) {
      this.handleTargetNodes()
      this.solved = true
      return
    }

    const nodeA = this.nodes[this.currentNodeIndex]!
    const minX =
      nodeA.center.x - nodeA.width / 2 - CAPACITY_NODE_BORDERING_EPSILON
    const minY =
      nodeA.center.y - nodeA.height / 2 - CAPACITY_NODE_BORDERING_EPSILON
    const maxX =
      nodeA.center.x + nodeA.width / 2 + CAPACITY_NODE_BORDERING_EPSILON
    const maxY =
      nodeA.center.y + nodeA.height / 2 + CAPACITY_NODE_BORDERING_EPSILON
    const candidateNodeIndexes = this.nodeIndex!.search(minX, minY, maxX, maxY)
      .filter((nodeIndex) => nodeIndex > this.currentNodeIndex)
      .sort((a, b) => a - b)

    for (const nodeIndex of candidateNodeIndexes) {
      const nodeB = this.nodes[nodeIndex]!
      const strawNodesWithSameParent =
        nodeA._strawNode &&
        nodeB._strawNode &&
        nodeA._strawParentCapacityMeshNodeId ===
          nodeB._strawParentCapacityMeshNodeId

      if (
        !strawNodesWithSameParent &&
        areNodesBordering(nodeA, nodeB) &&
        this.doNodesHaveSharedLayer(nodeA, nodeB)
      ) {
        this.edges.push({
          capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
          nodeIds: [nodeA.capacityMeshNodeId, nodeB.capacityMeshNodeId],
        })
      }
    }

    this.currentNodeIndex++
  }
}

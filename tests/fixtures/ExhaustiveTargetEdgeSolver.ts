import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types/capacity-mesh-types"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"

export class ExhaustiveTargetEdgeSolver extends CapacityMeshEdgeSolver {
  override handleTargetNodes(): void {
    const targetNodes = this.nodes.filter((node): boolean =>
      Boolean(node._containsTarget),
    )
    const nodeById = new Map<CapacityMeshNodeId, CapacityMeshNode>(
      this.nodes.map((node): [CapacityMeshNodeId, CapacityMeshNode] => [
        node.capacityMeshNodeId,
        node,
      ]),
    )

    for (let i = 0; i < targetNodes.length; i++) {
      for (let j = i + 1; j < targetNodes.length; j++) {
        const nodeA = targetNodes[i]!
        const nodeB = targetNodes[j]!
        if (!this.doNodesHaveSharedLayer(nodeA, nodeB)) continue
        if (!this.doNodesTouchOrOverlap(nodeA, nodeB)) continue
        if (this.hasEdgeBetween(nodeA, nodeB)) continue

        this.edges.push({
          capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
          nodeIds: [nodeA.capacityMeshNodeId, nodeB.capacityMeshNodeId],
        })
      }
    }

    for (const targetNode of targetNodes) {
      if (!targetNode._containsObstacle || !targetNode._targetConnectionName) {
        continue
      }

      const hasRoutingEdge = this.edges.some((edge): boolean => {
        if (!edge.nodeIds.includes(targetNode.capacityMeshNodeId)) return false
        const otherNodeId =
          edge.nodeIds[0] === targetNode.capacityMeshNodeId
            ? edge.nodeIds[1]
            : edge.nodeIds[0]
        const otherNode = nodeById.get(otherNodeId)
        if (!otherNode) return false

        return (
          !otherNode._containsObstacle &&
          !otherNode._containsTarget &&
          this.doNodesHaveSharedLayer(targetNode, otherNode)
        )
      })
      if (hasRoutingEdge) continue

      throw new Error(
        `Target obstacle region "${targetNode.capacityMeshNodeId}" for connection "${targetNode._targetConnectionName}" has no bordering routing edge`,
      )
    }
  }
}

import type { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
} from "../../types/capacity-mesh-types"
import { BaseSolver } from "../BaseSolver"
import { distance } from "@tscircuit/math-utils"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"

export class CapacityMeshEdgeSolver2_NodeTreeOptimization extends CapacityMeshEdgeSolver {
  override getSolverName(): string {
    return "CapacityMeshEdgeSolver2_NodeTreeOptimization"
  }

  private nodeTree: CapacityNodeTree
  private currentNodeIndex: number
  private edgeSet: Set<string>

  constructor(public nodes: CapacityMeshNode[]) {
    super(nodes)
    this.MAX_ITERATIONS = 10e6
    this.nodeTree = new CapacityNodeTree(this.nodes)
    this.currentNodeIndex = 0
    this.edgeSet = new Set<string>()
  }

  private areTargetNodesTouchingOrOverlapping(
    node1: CapacityMeshNode,
    node2: CapacityMeshNode,
  ): boolean {
    if (!node1._containsTarget && !node2._containsTarget) {
      return false
    }

    const epsilon = 1e-4
    const node1MinX = node1.center.x - node1.width / 2
    const node1MaxX = node1.center.x + node1.width / 2
    const node1MinY = node1.center.y - node1.height / 2
    const node1MaxY = node1.center.y + node1.height / 2
    const node2MinX = node2.center.x - node2.width / 2
    const node2MaxX = node2.center.x + node2.width / 2
    const node2MinY = node2.center.y - node2.height / 2
    const node2MaxY = node2.center.y + node2.height / 2

    return (
      node1MinX <= node2MaxX + epsilon &&
      node1MaxX + epsilon >= node2MinX &&
      node1MinY <= node2MaxY + epsilon &&
      node1MaxY + epsilon >= node2MinY
    )
  }

  _step() {
    if (this.currentNodeIndex >= this.nodes.length) {
      this.handleTargetNodes()
      this.solved = true
      return
    }

    const A = this.nodes[this.currentNodeIndex]
    const maybeAdjNodes = this.nodeTree.getNodesInArea(
      A.center.x,
      A.center.y,
      A.width * 2,
      A.height * 2,
    )

    for (const B of maybeAdjNodes) {
      const areAdjacent =
        areNodesBordering(A, B) ||
        this.areTargetNodesTouchingOrOverlapping(A, B)
      if (!areAdjacent) continue
      const strawNodesWithSameParent =
        A._strawNode &&
        B._strawNode &&
        A._strawParentCapacityMeshNodeId === B._strawParentCapacityMeshNodeId
      if (
        A.capacityMeshNodeId !== B.capacityMeshNodeId && // Don't connect a node to itself
        !strawNodesWithSameParent &&
        this.doNodesHaveSharedLayer(A, B) &&
        !this.edgeSet.has(`${A.capacityMeshNodeId}-${B.capacityMeshNodeId}`)
      ) {
        this.edgeSet.add(`${A.capacityMeshNodeId}-${B.capacityMeshNodeId}`)
        this.edgeSet.add(`${B.capacityMeshNodeId}-${A.capacityMeshNodeId}`)
        this.edges.push({
          capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
          nodeIds: [A.capacityMeshNodeId, B.capacityMeshNodeId],
        })
      }
    }

    this.currentNodeIndex++
  }
}

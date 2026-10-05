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
      const areBordering = areNodesBordering(A, B)
      if (!areBordering) continue
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

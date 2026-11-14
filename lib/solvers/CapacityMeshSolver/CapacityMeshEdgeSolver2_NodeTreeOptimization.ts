import Flatbush from "flatbush"
import { CAPACITY_NODE_TREE_CELL_SIZE } from "lib/data-structures/CapacityNodeTree"
import {
  areNodesBordering,
  NODE_BORDER_EPSILON,
} from "lib/utils/areNodesBordering"
import type { CapacityMeshNode } from "../../types/capacity-mesh-types"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"

export class CapacityMeshEdgeSolver2_NodeTreeOptimization extends CapacityMeshEdgeSolver {
  override getSolverName(): string {
    return "CapacityMeshEdgeSolver2_NodeTreeOptimization"
  }

  private nodeTree: Flatbush | null
  private currentNodeIndex: number
  private edgeSet: Set<string>

  constructor(public nodes: CapacityMeshNode[]) {
    super(nodes)
    this.MAX_ITERATIONS = 10e6
    this.nodeTree = new Flatbush(Math.max(1, nodes.length))
    for (const node of nodes) {
      this.nodeTree.add(
        node.center.x - node.width / 2,
        node.center.y - node.height / 2,
        node.center.x + node.width / 2,
        node.center.y + node.height / 2,
      )
    }
    if (nodes.length > 0) this.nodeTree.finish()
    this.currentNodeIndex = 0
    this.edgeSet = new Set<string>()
  }

  _step(): void {
    if (this.currentNodeIndex >= this.nodes.length) {
      // The pipeline retains completed solvers; release private lookup state.
      this.nodeTree = null
      this.edgeSet.clear()
      this.handleTargetNodes()
      this.solved = true
      return
    }

    const A: CapacityMeshNode = this.nodes[this.currentNodeIndex]
    const cellSize: number = CAPACITY_NODE_TREE_CELL_SIZE
    const minBucketX: number = Math.floor((A.center.x - A.width) / cellSize)
    const minBucketY: number = Math.floor((A.center.y - A.height) / cellSize)
    const maxBucketX: number = Math.floor((A.center.x + A.width) / cellSize)
    const maxBucketY: number = Math.floor((A.center.y + A.height) / cellSize)
    const adjacentNodeIndices: number[] = this.nodeTree!.search(
      A.center.x - A.width / 2 - NODE_BORDER_EPSILON,
      A.center.y - A.height / 2 - NODE_BORDER_EPSILON,
      A.center.x + A.width / 2 + NODE_BORDER_EPSILON,
      A.center.y + A.height / 2 + NODE_BORDER_EPSILON,
      (nodeIndex: number): boolean => {
        const B: CapacityMeshNode = this.nodes[nodeIndex]
        return (
          areNodesBordering(A, B) &&
          Math.floor((B.center.x - B.width / 2) / cellSize) <= maxBucketX &&
          Math.floor((B.center.x + B.width / 2) / cellSize) >= minBucketX &&
          Math.floor((B.center.y - B.height / 2) / cellSize) <= maxBucketY &&
          Math.floor((B.center.y + B.height / 2) / cellSize) >= minBucketY
        )
      },
    )
    // Keep the first bucket encounter order of CapacityNodeTree so edge IDs and
    // the downstream routing order stay unchanged.
    adjacentNodeIndices.sort((a: number, b: number): number => {
      const nodeA: CapacityMeshNode = this.nodes[a]
      const nodeB: CapacityMeshNode = this.nodes[b]
      const minBucketAX: number = Math.floor(
        (nodeA.center.x - nodeA.width / 2) / cellSize,
      )
      const minBucketAY: number = Math.floor(
        (nodeA.center.y - nodeA.height / 2) / cellSize,
      )
      const minBucketBX: number = Math.floor(
        (nodeB.center.x - nodeB.width / 2) / cellSize,
      )
      const minBucketBY: number = Math.floor(
        (nodeB.center.y - nodeB.height / 2) / cellSize,
      )
      return (
        Math.max(minBucketX, minBucketAX) - Math.max(minBucketX, minBucketBX) ||
        Math.max(minBucketY, minBucketAY) - Math.max(minBucketY, minBucketBY) ||
        a - b
      )
    })

    for (const nodeIndex of adjacentNodeIndices) {
      const B: CapacityMeshNode = this.nodes[nodeIndex]
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

import Flatbush from "flatbush"
import { CAPACITY_NODE_TREE_CELL_SIZE } from "../../data-structures/CapacityNodeTree"
import type { CapacityMeshNode } from "../../types/capacity-mesh-types"
import { areNodesBordering } from "../../utils/areNodesBordering"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"

export class CapacityMeshEdgeSolver3_Flatbush extends CapacityMeshEdgeSolver {
  private readonly nodeIndex?: Flatbush
  private currentNodeIndex = 0
  private readonly edgeSet = new Set<string>()

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
    const minX = nodeA.center.x - nodeA.width
    const minY = nodeA.center.y - nodeA.height
    const maxX = nodeA.center.x + nodeA.width
    const maxY = nodeA.center.y + nodeA.height
    // Edge order affects deterministic path selection downstream.
    const candidateNodeIndexes = this.nodeIndex!.search(
      minX,
      minY,
      maxX,
      maxY,
    ).sort((a, b) => this.compareLegacyCandidateOrder(nodeA, a, b))

    for (const nodeIndex of candidateNodeIndexes) {
      const nodeB = this.nodes[nodeIndex]!
      const strawNodesWithSameParent =
        nodeA._strawNode &&
        nodeB._strawNode &&
        nodeA._strawParentCapacityMeshNodeId ===
          nodeB._strawParentCapacityMeshNodeId

      if (
        nodeA.capacityMeshNodeId !== nodeB.capacityMeshNodeId &&
        !strawNodesWithSameParent &&
        areNodesBordering(nodeA, nodeB) &&
        this.doNodesHaveSharedLayer(nodeA, nodeB) &&
        !this.edgeSet.has(
          `${nodeA.capacityMeshNodeId}-${nodeB.capacityMeshNodeId}`,
        )
      ) {
        this.edgeSet.add(
          `${nodeA.capacityMeshNodeId}-${nodeB.capacityMeshNodeId}`,
        )
        this.edgeSet.add(
          `${nodeB.capacityMeshNodeId}-${nodeA.capacityMeshNodeId}`,
        )
        this.edges.push({
          capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
          nodeIds: [nodeA.capacityMeshNodeId, nodeB.capacityMeshNodeId],
        })
      }
    }

    this.currentNodeIndex++
  }

  private compareLegacyCandidateOrder(
    nodeA: CapacityMeshNode,
    nodeIndexA: number,
    nodeIndexB: number,
  ): number {
    const bucketRankA = this.getFirstLegacyBucketRank(
      nodeA,
      this.nodes[nodeIndexA]!,
    )
    const bucketRankB = this.getFirstLegacyBucketRank(
      nodeA,
      this.nodes[nodeIndexB]!,
    )
    return bucketRankA - bucketRankB || nodeIndexA - nodeIndexB
  }

  private getFirstLegacyBucketRank(
    queryNode: CapacityMeshNode,
    candidateNode: CapacityMeshNode,
  ): number {
    const queryMinBucketX = Math.floor(
      (queryNode.center.x - queryNode.width) / CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const queryMinBucketY = Math.floor(
      (queryNode.center.y - queryNode.height) / CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const queryMaxBucketY = Math.floor(
      (queryNode.center.y + queryNode.height) / CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const candidateMinBucketX = Math.floor(
      (candidateNode.center.x - candidateNode.width / 2) /
        CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const candidateMinBucketY = Math.floor(
      (candidateNode.center.y - candidateNode.height / 2) /
        CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const firstBucketX = Math.max(queryMinBucketX, candidateMinBucketX)
    const firstBucketY = Math.max(queryMinBucketY, candidateMinBucketY)

    return (
      (firstBucketX - queryMinBucketX) *
        (queryMaxBucketY - queryMinBucketY + 1) +
      firstBucketY -
      queryMinBucketY
    )
  }
}

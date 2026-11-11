import { CAPACITY_NODE_TREE_CELL_SIZE } from "lib/data-structures/CapacityNodeTree"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import {
  areNodesBordering,
  NODE_BORDER_EPSILON,
} from "lib/utils/areNodesBordering"
import type { CapacityMeshNode } from "../../types/capacity-mesh-types"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"

type IndexedCapacityMeshNode = {
  node: CapacityMeshNode
  nodeIndex: number
  minBucketX: number
  minBucketY: number
  maxBucketX: number
  maxBucketY: number
}

export class CapacityMeshEdgeSolver2_NodeTreeOptimization extends CapacityMeshEdgeSolver {
  override getSolverName(): string {
    return "CapacityMeshEdgeSolver2_NodeTreeOptimization"
  }

  private nodeTree: FlatbushIndex<IndexedCapacityMeshNode>
  private currentNodeIndex: number
  private edgeSet: Set<string>

  constructor(public nodes: CapacityMeshNode[]) {
    super(nodes)
    this.MAX_ITERATIONS = 10e6
    this.nodeTree = new FlatbushIndex<IndexedCapacityMeshNode>(nodes.length)
    for (const [nodeIndex, node] of nodes.entries()) {
      const minX: number = node.center.x - node.width / 2
      const minY: number = node.center.y - node.height / 2
      const maxX: number = node.center.x + node.width / 2
      const maxY: number = node.center.y + node.height / 2
      const indexedNode: IndexedCapacityMeshNode = {
        node,
        nodeIndex,
        minBucketX: Math.floor(minX / CAPACITY_NODE_TREE_CELL_SIZE),
        minBucketY: Math.floor(minY / CAPACITY_NODE_TREE_CELL_SIZE),
        maxBucketX: Math.floor(maxX / CAPACITY_NODE_TREE_CELL_SIZE),
        maxBucketY: Math.floor(maxY / CAPACITY_NODE_TREE_CELL_SIZE),
      }
      this.nodeTree.insert(indexedNode, minX, minY, maxX, maxY)
    }
    if (nodes.length > 0) this.nodeTree.finish()
    this.currentNodeIndex = 0
    this.edgeSet = new Set<string>()
  }

  _step(): void {
    if (this.currentNodeIndex >= this.nodes.length) {
      this.handleTargetNodes()
      this.solved = true
      return
    }

    const A: CapacityMeshNode = this.nodes[this.currentNodeIndex]
    const minBucketX: number = Math.floor(
      (A.center.x - A.width) / CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const minBucketY: number = Math.floor(
      (A.center.y - A.height) / CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const maxBucketX: number = Math.floor(
      (A.center.x + A.width) / CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const maxBucketY: number = Math.floor(
      (A.center.y + A.height) / CAPACITY_NODE_TREE_CELL_SIZE,
    )
    const adjacentNodes: IndexedCapacityMeshNode[] = this.nodeTree
      .search(
        A.center.x - A.width / 2 - NODE_BORDER_EPSILON,
        A.center.y - A.height / 2 - NODE_BORDER_EPSILON,
        A.center.x + A.width / 2 + NODE_BORDER_EPSILON,
        A.center.y + A.height / 2 + NODE_BORDER_EPSILON,
      )
      .filter(
        (candidate): boolean =>
          candidate.minBucketX <= maxBucketX &&
          candidate.maxBucketX >= minBucketX &&
          candidate.minBucketY <= maxBucketY &&
          candidate.maxBucketY >= minBucketY &&
          areNodesBordering(A, candidate.node),
      )
    // Keep the first bucket encounter order of CapacityNodeTree so edge IDs and
    // the downstream routing order stay unchanged.
    adjacentNodes.sort(
      (a, b): number =>
        Math.max(minBucketX, a.minBucketX) -
          Math.max(minBucketX, b.minBucketX) ||
        Math.max(minBucketY, a.minBucketY) -
          Math.max(minBucketY, b.minBucketY) ||
        a.nodeIndex - b.nodeIndex,
    )

    for (const { node: B } of adjacentNodes) {
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

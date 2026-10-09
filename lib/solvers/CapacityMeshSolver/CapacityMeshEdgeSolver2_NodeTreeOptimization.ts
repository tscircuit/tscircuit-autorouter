import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import { CAPACITY_NODE_TREE_CELL_SIZE } from "lib/data-structures/CapacityNodeTree"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "../../types/capacity-mesh-types"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"

const EDGE_SEARCH_MARGIN = 0.001

type IndexedCapacityMeshNode = {
  node: CapacityMeshNode
  nodeIndex: number
}
type DirectedCapacityMeshEdgeKey = `${CapacityMeshNodeId}-${CapacityMeshNodeId}`

export class CapacityMeshEdgeSolver2_NodeTreeOptimization extends CapacityMeshEdgeSolver {
  override getSolverName(): string {
    return "CapacityMeshEdgeSolver2_NodeTreeOptimization"
  }

  private nodeIndex: FlatbushIndex<IndexedCapacityMeshNode> | null
  private currentNodeIndex: number
  private edgeSet: Set<DirectedCapacityMeshEdgeKey>

  constructor(public nodes: CapacityMeshNode[]) {
    super(nodes)
    this.MAX_ITERATIONS = 10e6
    this.nodeIndex =
      this.nodes.length > 0 ? new FlatbushIndex(this.nodes.length) : null
    for (let nodeIndex = 0; nodeIndex < this.nodes.length; nodeIndex++) {
      const node = this.nodes[nodeIndex]!
      const bounds = getBoundFromCenteredRect(node)
      this.nodeIndex!.insert(
        { node, nodeIndex },
        bounds.minX,
        bounds.minY,
        bounds.maxX,
        bounds.maxY,
      )
    }
    this.nodeIndex?.finish()
    this.currentNodeIndex = 0
    this.edgeSet = new Set<DirectedCapacityMeshEdgeKey>()
  }

  _step() {
    if (this.currentNodeIndex >= this.nodes.length) {
      this.handleTargetNodes()
      this.solved = true
      return
    }

    const A = this.nodes[this.currentNodeIndex]
    const bounds = getBoundFromCenteredRect(A)
    const previousSearchMinX = A.center.x - A.width
    const previousSearchMinY = A.center.y - A.height
    const maybeAdjacentNodes = this.nodeIndex!.search(
      bounds.minX - EDGE_SEARCH_MARGIN,
      bounds.minY - EDGE_SEARCH_MARGIN,
      bounds.maxX + EDGE_SEARCH_MARGIN,
      bounds.maxY + EDGE_SEARCH_MARGIN,
    ).sort((a, b) => {
      const aBounds = getBoundFromCenteredRect(a.node)
      const bBounds = getBoundFromCenteredRect(b.node)
      const aFirstBucketX = Math.floor(
        Math.max(previousSearchMinX, aBounds.minX) /
          CAPACITY_NODE_TREE_CELL_SIZE,
      )
      const bFirstBucketX = Math.floor(
        Math.max(previousSearchMinX, bBounds.minX) /
          CAPACITY_NODE_TREE_CELL_SIZE,
      )
      const aFirstBucketY = Math.floor(
        Math.max(previousSearchMinY, aBounds.minY) /
          CAPACITY_NODE_TREE_CELL_SIZE,
      )
      const bFirstBucketY = Math.floor(
        Math.max(previousSearchMinY, bBounds.minY) /
          CAPACITY_NODE_TREE_CELL_SIZE,
      )

      return (
        aFirstBucketX - bFirstBucketX ||
        aFirstBucketY - bFirstBucketY ||
        a.nodeIndex - b.nodeIndex
      )
    })

    for (const { node: B } of maybeAdjacentNodes) {
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

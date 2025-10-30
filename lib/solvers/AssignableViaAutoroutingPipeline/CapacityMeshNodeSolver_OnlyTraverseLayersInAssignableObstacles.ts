import type { SimpleRouteJson, Obstacle, CapacityMeshNode } from "../../types"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "../CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"

interface CapacityMeshNodeSolverOptions {
  capacityDepth?: number
}

/**
 * This capacity mesh node solver is meant to be used in contexts where vias
 * aren't allowed, but there may be assignable vias on the PCB as obstacles.
 *
 * Behavior:
 * - Outside obstacles, multi-layer nodes are *always* Z-split into single-layer nodes.
 * - Inside an "assignable" obstacle (obstacle.netIsAssignable === true), we keep
 *   exactly *one* multi-layer node (capacity ~ 1 via region), i.e. we do not Z-split it.
 *   Further nodes completely inside the same assignable obstacle will be Z-split (one per layer).
 * - Single-layer nodes that are larger than MAX_SIZE_FOR_SINGLE_LAYER_NODES are XY-subdivided.
 * - IMPORTANT: the single multi-layer node inside an assignable obstacle is **traversable**,
 *   so we mark `_containsObstacle = false` and `_completelyInsideObstacle = false` on it.
 */
export class CapacityMeshNodeSolver_OnlyTraverseLayersInAssignableObstacles extends CapacityMeshNodeSolver2_NodeUnderObstacle {
  MAX_SIZE_FOR_SINGLE_LAYER_NODES = 2 // 2x2mm

  constructor(
    public srj: SimpleRouteJson,
    public opts: CapacityMeshNodeSolverOptions = {},
  ) {
    super(srj, opts)
  }

  private isObstacleAssignable(ob: Obstacle): boolean {
    return Boolean((ob as any)?.netIsAssignable)
  }

  private getOverlappingAssignableObstacles(
    node: CapacityMeshNode,
  ): Obstacle[] {
    return this.getXYZOverlappingObstacles(node).filter((o) =>
      this.isObstacleAssignable(o),
    )
  }

  private isNodeCompletelyInsideSpecificObstacle(
    node: CapacityMeshNode,
    obstacle: Obstacle,
  ): boolean {
    const nb = this.getNodeBounds(node)
    const obsLeft = obstacle.center.x - obstacle.width / 2
    const obsRight = obstacle.center.x + obstacle.width / 2
    const obsTop = obstacle.center.y - obstacle.height / 2
    const obsBottom = obstacle.center.y + obstacle.height / 2

    return (
      nb.minX >= obsLeft &&
      nb.maxX <= obsRight &&
      nb.minY >= obsTop &&
      nb.maxY <= obsBottom
    )
  }

  private getAssignableContainer(node: CapacityMeshNode): Obstacle | null {
    const assignables = this.getOverlappingAssignableObstacles(node)
    for (const o of assignables) {
      return o
    }
    return null
  }

  shouldNodeBeXYSubdivided(node: CapacityMeshNode) {
    if (node._depth! >= this.MAX_DEPTH) return false
    if (node._containsTarget) return true
    if (node._containsObstacle && !node._completelyInsideObstacle) return true

    if (
      node.availableZ.length === 1 &&
      (node.width > this.MAX_SIZE_FOR_SINGLE_LAYER_NODES ||
        node.height > this.MAX_SIZE_FOR_SINGLE_LAYER_NODES)
    ) {
      return true
    }
    return false
  }

  /**
   * Multi-layer nodes are filtered unless they are completely inside an
   * assignable obstacle (the single allowed via region per obstacle).
   * Single-layer nodes use the standard relaxed single-layer filtering.
   */
  shouldFilterNodeForObstacle(node: CapacityMeshNode): boolean {
    if (!node._containsObstacle) return false

    if (node.availableZ.length === 1) {
      return this.shouldFilterSingleLayerNodeForObstacle(node)
    }

    // Multi-layer: allowed only if it is the single node inside an assignable obstacle
    const container = this.getAssignableContainer(node)
    if (container) return false

    return true
  }

  _step() {
    const nextNode = this.unfinishedNodes.pop()
    if (!nextNode) {
      this.solved = true
      return
    }

    const childNodes = this.getChildNodes(nextNode)

    const finishedNewNodes: CapacityMeshNode[] = []
    const unfinishedNewNodes: CapacityMeshNode[] = []

    for (const childNode of childNodes) {
      const shouldBeXYSubdivided = this.shouldNodeBeXYSubdivided(childNode)

      // Detect an assignable container that fully contains this node and is not yet claimed
      const assignableContainer =
        childNode.availableZ.length > 1 && !shouldBeXYSubdivided
          ? this.getAssignableContainer(childNode)
          : null

      // Z-subdivide multi-layer nodes except when this is the *one* allowed via region
      const shouldBeZSubdivided =
        childNode.availableZ.length > 1 &&
        !shouldBeXYSubdivided &&
        !assignableContainer

      if (shouldBeXYSubdivided) {
        unfinishedNewNodes.push(childNode)
        continue
      }

      if (shouldBeZSubdivided) {
        const zSubNodes = this.getZSubdivisionChildNodes(childNode)
        for (const n of zSubNodes) {
          if (!n._containsTarget && this.shouldFilterNodeForObstacle(n)) {
            continue
          }
          if (this.shouldNodeBeXYSubdivided(n)) {
            unfinishedNewNodes.push(n)
          } else {
            n._containsObstacle = false
            finishedNewNodes.push(n)
          }
        }
        continue
      }

      // Not XY-subdivided and not Z-subdivided:
      //  - a single-layer node that passes filtering, or
      //  - the *single* multi-layer node inside an assignable obstacle
      if (
        !this.shouldFilterNodeForObstacle(childNode) ||
        childNode._containsTarget
      ) {
        if (assignableContainer) {
          // >>> IMPORTANT FIX <<<
          // The multi-layer node inside an assignable obstacle is traversable.
          // Mark it as *not* containing an obstacle.
          childNode._containsObstacle = false
          childNode._completelyInsideObstacle = false
          ;(childNode as any)._assignedViaObstacle = assignableContainer
        }
        finishedNewNodes.push(childNode)
      }
    }

    this.unfinishedNodes.push(...unfinishedNewNodes)
    this.finishedNodes.push(...finishedNewNodes)
  }
}

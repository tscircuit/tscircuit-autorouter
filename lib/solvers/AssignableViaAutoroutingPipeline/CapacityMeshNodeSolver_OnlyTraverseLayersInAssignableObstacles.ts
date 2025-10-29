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
 */
export class CapacityMeshNodeSolver_OnlyTraverseLayersInAssignableObstacles extends CapacityMeshNodeSolver2_NodeUnderObstacle {
  MAX_SIZE_FOR_SINGLE_LAYER_NODES = 4 // 4x4mm

  /** Track which assignable obstacles have already received their single multi-layer node */
  private claimedAssignableObstacles: WeakSet<Obstacle> = new WeakSet()

  constructor(
    public srj: SimpleRouteJson,
    public opts: CapacityMeshNodeSolverOptions = {},
  ) {
    super(srj, opts)
  }

  /** Whether an obstacle is a designated assignable-via region */
  private isObstacleAssignable(ob: Obstacle): boolean {
    return Boolean((ob as any)?.netIsAssignable)
  }

  /** Assignable obstacles that overlap this node in XY *and* Z */
  private getOverlappingAssignableObstacles(
    node: CapacityMeshNode,
  ): Obstacle[] {
    return this.getXYZOverlappingObstacles(node).filter((o) =>
      this.isObstacleAssignable(o),
    )
  }

  /** Is this node completely inside the given obstacle's rectangle? */
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

  /**
   * If there is an assignable obstacle that completely contains this node
   * and hasn't yet been used to create a multi-layer node, return it.
   */
  private getAssignableContainer(node: CapacityMeshNode): Obstacle | null {
    const assignables = this.getOverlappingAssignableObstacles(node)
    for (const o of assignables) {
      if (
        !this.claimedAssignableObstacles.has(o) &&
        this.isNodeCompletelyInsideSpecificObstacle(node, o)
      ) {
        return o
      }
    }
    return null
  }

  /**
   * XY subdivision rules specialized for this solver:
   *  - Subdivide if the node contains a target.
   *  - Subdivide if the node intersects an obstacle boundary (not completely inside).
   *  - Subdivide single-layer nodes that are larger than MAX_SIZE_FOR_SINGLE_LAYER_NODES.
   */
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
      // Reuse parent behavior for single-layer (20% coverage threshold)
      return this.shouldFilterSingleLayerNodeForObstacle(node)
    }

    // Multi-layer: only allowed as the single node inside an assignable obstacle
    const container = this.getAssignableContainer(node)
    if (container) return false

    return true
  }

  /**
   * Custom step that:
   *  - Always Z-splits multi-layer nodes outside assignable obstacles
   *  - Keeps exactly one multi-layer node per assignable obstacle
   *  - Ensures Z-split single-layer nodes are further XY-subdivided if "too big"
   */
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

      // Candidate assignable obstacle that fully contains the node & isn't claimed yet
      const assignableContainer =
        childNode.availableZ.length > 1 && !shouldBeXYSubdivided
          ? this.getAssignableContainer(childNode)
          : null

      // Z-subdivide multi-layer nodes except when this is the one allowed via region
      const shouldBeZSubdivided =
        childNode.availableZ.length > 1 &&
        !shouldBeXYSubdivided &&
        !assignableContainer

      if (shouldBeXYSubdivided) {
        unfinishedNewNodes.push(childNode)
        continue
      }

      if (shouldBeZSubdivided) {
        // Split into per-layer nodes, then apply obstacle filtering and size gating
        const zSubNodes = this.getZSubdivisionChildNodes(childNode)
        for (const n of zSubNodes) {
          if (!n._containsTarget && this.shouldFilterNodeForObstacle(n)) {
            continue
          }
          if (this.shouldNodeBeXYSubdivided(n)) {
            unfinishedNewNodes.push(n)
          } else {
            finishedNewNodes.push(n)
          }
        }
        continue
      }

      // Not XY subdivided and not Z subdivided:
      // - a single-layer node that passed filtering, or
      // - the one multi-layer node inside an assignable obstacle
      if (
        !this.shouldFilterNodeForObstacle(childNode) ||
        childNode._containsTarget
      ) {
        finishedNewNodes.push(childNode)
        if (assignableContainer) {
          // Ensure we only create one multi-layer node per assignable obstacle
          this.claimedAssignableObstacles.add(assignableContainer)
        }
      }
    }

    this.unfinishedNodes.push(...unfinishedNewNodes)
    this.finishedNodes.push(...finishedNewNodes)
  }
}

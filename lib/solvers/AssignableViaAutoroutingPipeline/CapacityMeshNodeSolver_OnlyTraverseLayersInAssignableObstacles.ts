import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "../../types"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "../CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"

interface CapacityMeshNodeSolverOptions {
  capacityDepth?: number
}

/**
 * This capacity mesh node solver is meant to be used in contexts where vias
 * aren't allowed, but there may be assignable vias on the PCB as obstacles.
 *
 * The behavior is different than other Capacity Mesh Node solvers in that:
 * - If there is no obstacle, instead of having a multi-layer capacity mesh node
 *   we have two single-layer capacity mesh nodes
 * - If we have an "assignable" obstacle, i.e. an obstacle with "netIsAssignable"
 *   set to true we create a multi-layer capacity mesh node with a capacity of
 *   1 (a single via)
 *   - NOTE: There is only ONE multi-layer capacity mesh node per assignable obstacle
 * - Mesh nodes should not be "too big", if a capacity mesh node is more than
 *   MAX_SIZE_FOR_SINGLE_LAYER_NODES it will be split into 4 smaller nodes
 */
export class CapacityMeshNodeSolver_OnlyTraverseLayersInAssignableObstacles extends CapacityMeshNodeSolver2_NodeUnderObstacle {
  MAX_SIZE_FOR_SINGLE_LAYER_NODES = 4 // 4x4mm

  // Track which assignable obstacles already have a multi-layer node assigned
  private assignedObstacleIds = new Set<string>()

  constructor(
    public srj: SimpleRouteJson,
    public opts: CapacityMeshNodeSolverOptions = {},
  ) {
    super(srj, opts)
  }

  /**
   * Get the assignable obstacles that overlap with this node
   */
  private getAssignableObstacles(node: CapacityMeshNode) {
    const overlappingObstacles = this.getXYZOverlappingObstacles(node)
    return overlappingObstacles.filter((o) => o.netIsAssignable)
  }

  /**
   * Get a unique ID for an obstacle (using its position and size)
   */
  private getObstacleId(obstacle: Obstacle): string {
    return `${obstacle.center.x}_${obstacle.center.y}_${obstacle.width}_${obstacle.height}`
  }

  /**
   * Check if this node contains an unassigned assignable obstacle
   */
  private hasUnassignedAssignableObstacle(node: CapacityMeshNode): boolean {
    const assignableObstacles = this.getAssignableObstacles(node)
    return assignableObstacles.some(
      (o) => !this.assignedObstacleIds.has(this.getObstacleId(o)),
    )
  }

  /**
   * Mark assignable obstacles in this node as assigned
   */
  private markAssignableObstaclesAsAssigned(node: CapacityMeshNode): void {
    const assignableObstacles = this.getAssignableObstacles(node)
    for (const obstacle of assignableObstacles) {
      this.assignedObstacleIds.add(this.getObstacleId(obstacle))
    }
  }

  /**
   * Override to add size check for single-layer nodes
   */
  override shouldNodeBeXYSubdivided(node: CapacityMeshNode) {
    if (node._depth! >= this.MAX_DEPTH) return false
    if (node._containsTarget) return true

    // If this is a single-layer node that's too big, subdivide it
    if (
      node.availableZ.length === 1 &&
      (node.width > this.MAX_SIZE_FOR_SINGLE_LAYER_NODES ||
        node.height > this.MAX_SIZE_FOR_SINGLE_LAYER_NODES)
    ) {
      return true
    }

    if (node._containsObstacle && !node._completelyInsideObstacle) return true
    return false
  }

  /**
   * Override the main stepping function to implement the custom Z-subdivision logic
   */
  override _step() {
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

      // Custom Z-subdivision logic:
      // - Multi-layer nodes should be Z-subdivided UNLESS they contain an unassigned assignable obstacle
      // - Single-layer nodes are never Z-subdivided
      let shouldBeZSubdivided = false
      if (childNode.availableZ.length > 1 && !shouldBeXYSubdivided) {
        // Check if this node contains an unassigned assignable obstacle
        const hasUnassignedAssignable =
          this.hasUnassignedAssignableObstacle(childNode)

        if (hasUnassignedAssignable) {
          // Keep as multi-layer node (don't Z-subdivide)
          // Mark the assignable obstacles as assigned
          this.markAssignableObstaclesAsAssigned(childNode)
          shouldBeZSubdivided = false
        } else {
          // No unassigned assignable obstacle, so Z-subdivide into single-layer nodes
          shouldBeZSubdivided = true
        }
      }

      if (shouldBeXYSubdivided) {
        unfinishedNewNodes.push(childNode)
      } else if (
        !shouldBeXYSubdivided &&
        !this.shouldFilterNodeForObstacle(childNode) &&
        !shouldBeZSubdivided
      ) {
        finishedNewNodes.push(childNode)
      } else if (!shouldBeXYSubdivided && childNode._containsTarget) {
        if (shouldBeZSubdivided) {
          const zSubNodes = this.getZSubdivisionChildNodes(childNode)
          finishedNewNodes.push(
            ...zSubNodes.filter(
              (n) => n._containsTarget || !this.shouldFilterNodeForObstacle(n),
            ),
          )
        } else {
          finishedNewNodes.push(childNode)
        }
      } else if (shouldBeZSubdivided) {
        finishedNewNodes.push(
          ...this.getZSubdivisionChildNodes(childNode).filter(
            (zSubNode) => !this.shouldFilterNodeForObstacle(zSubNode),
          ),
        )
      }
    }

    this.unfinishedNodes.push(...unfinishedNewNodes)
    this.finishedNodes.push(...finishedNewNodes)
  }
}

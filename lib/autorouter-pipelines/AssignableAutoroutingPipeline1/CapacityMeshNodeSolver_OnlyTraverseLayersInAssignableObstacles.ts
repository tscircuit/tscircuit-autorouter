import type { SimpleRouteJson, Obstacle, CapacityMeshNode } from "lib/types"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

interface CapacityMeshNodeSolverOptions {
  capacityDepth?: number
}

/**
 * This capacity mesh node solver is meant to be used in contexts where vias
 * aren't allowed, but there may be assignable vias on the PCB as obstacles.
 *
 * Behavior:
 * - Outside assignable obstacles, multi-layer nodes are *always* Z-split into single-layer nodes.
 * - During mesh subdivision, nodes overlapping with "assignable" obstacles
 *   (obstacle.netIsAssignable === true) are NOT filtered, allowing normal subdivision.
 * - After the main mesh subdivision is complete:
 *   1. All nodes overlapping with assignable obstacles are removed
 *   2. Each assignable obstacle is replaced with a single multi-layer node spanning all layers
 * - Single-layer nodes that are larger than MAX_SIZE_FOR_SINGLE_LAYER_NODES are XY-subdivided.
 * - IMPORTANT: the multi-layer nodes created from assignable obstacles are **traversable**,
 *   so we mark `_containsObstacle = false` and `_completelyInsideObstacle = false` on them.
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
   * Filter nodes for obstacles, but skip filtering for assignable obstacles.
   * Assignable obstacles will be handled separately at the end.
   */
  shouldFilterNodeForObstacle(node: CapacityMeshNode): boolean {
    if (!node._containsObstacle) return false

    // Check if this node overlaps with any assignable obstacles
    const assignableObstacles = this.getOverlappingAssignableObstacles(node)
    if (assignableObstacles.length > 0) {
      // Don't filter - let the node be created, we'll remove it later
      return false
    }

    if (node.availableZ.length === 1) {
      return this.shouldFilterSingleLayerNodeForObstacle(node)
    }

    // Multi-layer nodes (not in assignable obstacles) should be filtered
    return true
  }

  /**
   * Remove nodes inside assignable obstacles and replace with single multi-layer nodes.
   * The new node's bounds are extended to cover all removed nodes' XY space.
   */
  private insertAssignableObstaclesAsNodes() {
    const assignableObstacles = this.srj.obstacles.filter((o) =>
      this.isObstacleAssignable(o),
    )

    // Map to track which nodes overlap with which obstacle
    const obstacleToNodesMap = new Map<Obstacle, CapacityMeshNode[]>()

    for (const obstacle of assignableObstacles) {
      const overlappingNodes: CapacityMeshNode[] = []

      for (const node of this.finishedNodes) {
        // Check if this node overlaps with this assignable obstacle
        const nodeOverlaps = this.getXYZOverlappingObstacles(node).some(
          (o) => o === obstacle,
        )
        if (nodeOverlaps) {
          overlappingNodes.push(node)
        }
      }

      obstacleToNodesMap.set(obstacle, overlappingNodes)
    }

    // Collect all nodes to remove
    const nodesToRemove = new Set<CapacityMeshNode>()
    for (const nodes of obstacleToNodesMap.values()) {
      for (const node of nodes) {
        nodesToRemove.add(node)
      }
    }

    // Remove the nodes
    this.finishedNodes = this.finishedNodes.filter(
      (node) => !nodesToRemove.has(node),
    )

    // Add a single multi-layer node for each assignable obstacle
    for (const obstacle of assignableObstacles) {
      const overlappingNodes = obstacleToNodesMap.get(obstacle) || []
      const availableZ =
        obstacle.layers && obstacle.layers.length > 0
          ? Array.from(
              new Set(
                obstacle.layers.map((layer) =>
                  mapLayerNameToZ(layer, this.srj.layerCount),
                ),
              ),
            ).sort((a, b) => a - b)
          : Array.from(
              { length: this.srj.layerCount },
              (_, i) => this.srj.layerCount - i - 1,
            )

      // Calculate bounding box that covers all removed nodes
      let minX = obstacle.center.x - obstacle.width / 2
      let maxX = obstacle.center.x + obstacle.width / 2
      let minY = obstacle.center.y - obstacle.height / 2
      let maxY = obstacle.center.y + obstacle.height / 2

      for (const node of overlappingNodes) {
        const nodeMinX = node.center.x - node.width / 2
        const nodeMaxX = node.center.x + node.width / 2
        const nodeMinY = node.center.y - node.height / 2
        const nodeMaxY = node.center.y + node.height / 2

        minX = Math.min(minX, nodeMinX)
        maxX = Math.max(maxX, nodeMaxX)
        minY = Math.min(minY, nodeMinY)
        maxY = Math.max(maxY, nodeMaxY)
      }

      const width = maxX - minX
      const height = maxY - minY
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2

      // Check if this extended area contains any target points
      let containsTarget = false
      for (const conn of this.srj.connections) {
        for (const point of conn.pointsToConnect) {
          if (
            point.x >= minX &&
            point.x <= maxX &&
            point.y >= minY &&
            point.y <= maxY
          ) {
            containsTarget = true
            break
          }
        }
        if (containsTarget) break
      }

      // Create a multi-layer node with extended bounds
      const node: CapacityMeshNode = {
        capacityMeshNodeId: `assignable_via_${obstacle.center.x}_${obstacle.center.y}`,
        center: { x: centerX, y: centerY },
        width,
        height,
        layer:
          availableZ.length === 1
            ? `z${availableZ[0]}`
            : `z${availableZ.join(",")}`,
        availableZ,
        _depth: 0,
        _containsTarget: containsTarget,
        _containsObstacle: false,
        _completelyInsideObstacle: false,
      } as any

      // Store the obstacle reference for later use
      ;(node as any)._assignedViaObstacle = obstacle

      this.finishedNodes.push(node)
    }
  }

  _step() {
    const nextNode = this.unfinishedNodes.pop()
    if (!nextNode) {
      // Main subdivision complete, now insert assignable obstacles as nodes
      this.insertAssignableObstaclesAsNodes()
      this.solved = true
      return
    }

    const childNodes = this.getChildNodes(nextNode)

    const finishedNewNodes: CapacityMeshNode[] = []
    const unfinishedNewNodes: CapacityMeshNode[] = []

    for (const childNode of childNodes) {
      const shouldBeXYSubdivided = this.shouldNodeBeXYSubdivided(childNode)

      // Z-subdivide all multi-layer nodes (no special handling for assignable obstacles)
      const shouldBeZSubdivided =
        childNode.availableZ.length > 1 && !shouldBeXYSubdivided

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

      // Not XY-subdivided and not Z-subdivided: single-layer node that passes filtering
      if (
        !this.shouldFilterNodeForObstacle(childNode) ||
        childNode._containsTarget
      ) {
        finishedNewNodes.push(childNode)
      }
    }

    this.unfinishedNodes.push(...unfinishedNewNodes)
    this.finishedNodes.push(...finishedNewNodes)
  }
}

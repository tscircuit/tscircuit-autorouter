import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { GraphicsObject } from "graphics-debug"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import type { Obstacle } from "lib/types"

/**
 * This solver merges nodes that represent the same assignable obstacle into a single node.
 *
 * For each assignable obstacle:
 * - Finds all nodes that have _assignedViaObstacle pointing to that obstacle
 * - Replaces them with a single node representing the bounding box of all removed nodes
 * - Each step handles one assignable obstacle
 */
export class AssignableViaNodeMergerSolver extends BaseSolver {
  newNodes: CapacityMeshNode[]

  // Map of obstacle to list of nodes assigned to it
  obstacleToNodesMap: Map<Obstacle, CapacityMeshNode[]>

  // List of obstacles to process
  obstaclesToProcess: Obstacle[]

  // Set of node IDs that have been merged (absorbed into a single node)
  mergedNodeIds: Set<CapacityMeshNodeId>

  constructor(nodes: CapacityMeshNode[]) {
    super()
    this.MAX_ITERATIONS = 10_000
    this.newNodes = []
    this.obstacleToNodesMap = new Map()
    this.mergedNodeIds = new Set()

    // Group nodes by their assigned obstacle
    for (const node of nodes) {
      const assignedObstacle = (node as any)._assignedViaObstacle as
        | Obstacle
        | undefined

      if (assignedObstacle) {
        const existingNodes =
          this.obstacleToNodesMap.get(assignedObstacle) || []
        existingNodes.push(node)
        this.obstacleToNodesMap.set(assignedObstacle, existingNodes)
      } else {
        // Pass through nodes that are not assigned to any obstacle
        this.newNodes.push(node)
      }
    }

    this.obstaclesToProcess = Array.from(this.obstacleToNodesMap.keys())
  }

  _step() {
    const obstacle = this.obstaclesToProcess.pop()

    if (!obstacle) {
      this.solved = true
      return
    }

    const nodesToMerge = this.obstacleToNodesMap.get(obstacle)

    if (!nodesToMerge || nodesToMerge.length === 0) {
      return
    }

    // Calculate the bounding box of all nodes
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    // Collect all unique z-layers from the nodes to merge
    const zLayersSet = new Set<number>()
    let containsTarget = false

    for (const node of nodesToMerge) {
      const nodeMinX = node.center.x - node.width / 2
      const nodeMaxX = node.center.x + node.width / 2
      const nodeMinY = node.center.y - node.height / 2
      const nodeMaxY = node.center.y + node.height / 2

      minX = Math.min(minX, nodeMinX)
      maxX = Math.max(maxX, nodeMaxX)
      minY = Math.min(minY, nodeMinY)
      maxY = Math.max(maxY, nodeMaxY)

      // Collect all z-layers
      for (const z of node.availableZ) {
        zLayersSet.add(z)
      }

      // Check if any node contains a target
      if (node._containsTarget) {
        containsTarget = true
      }
    }

    const width = maxX - minX
    const height = maxY - minY
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    // Sort z-layers for consistent output
    const availableZ = Array.from(zLayersSet).sort((a, b) => a - b)

    // Create the merged node
    const mergedNode: CapacityMeshNode = {
      capacityMeshNodeId: `merged_via_${obstacle.center.x}_${obstacle.center.y}`,
      center: { x: centerX, y: centerY },
      width,
      height,
      layer:
        availableZ.length === 1
          ? `z${availableZ[0]}`
          : `z${availableZ.join(",")}`,
      availableZ,
      _containsTarget: containsTarget,
      _containsObstacle: false,
      _completelyInsideObstacle: false,
    }

    // Preserve the _assignedViaObstacle property
    ;(mergedNode as any)._assignedViaObstacle = obstacle

    // Mark all original nodes as merged
    for (const node of nodesToMerge) {
      this.mergedNodeIds.add(node.capacityMeshNodeId)
    }

    this.newNodes.push(mergedNode)
  }

  visualize(): GraphicsObject {
    const graphics = {
      circles: [],
      lines: [],
      points: [],
      rects: [],
      coordinateSystem: "cartesian",
      title: "Assignable Via Node Merger",
    } as GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles">

    // Visualize the new merged nodes
    for (const node of this.newNodes) {
      const rect = createRectFromCapacityNode(node)
      const assignedObstacle = (node as any)._assignedViaObstacle

      if (assignedObstacle) {
        rect.stroke = "rgba(255, 0, 255, 0.8)" // Magenta for merged via nodes
        rect.label = `${rect.label || ""}\n(merged via)`
      }

      graphics.rects.push(rect)
    }

    // Visualize obstacles that are still being processed
    const nextObstacle =
      this.obstaclesToProcess[this.obstaclesToProcess.length - 1]
    if (nextObstacle) {
      const nodesToMerge = this.obstacleToNodesMap.get(nextObstacle) || []

      for (const node of nodesToMerge) {
        const rect = createRectFromCapacityNode(node, { rectMargin: 0.01 })
        rect.stroke = "rgba(0, 255, 0, 0.8)" // Green for nodes being merged
        rect.label = `${rect.label || ""}\n(to be merged)`
        graphics.rects.push(rect)
      }
    }

    return graphics
  }
}

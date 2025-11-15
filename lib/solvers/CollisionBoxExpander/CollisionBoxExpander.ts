import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"
import { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import { expandCollisionBoxToConnect } from "./expandCollisionBoxToConnect"

export interface CollisionBoxExpanderOptions {
  // Options can be added here in the future if needed
}

/**
 * CollisionBoxExpander addresses connectivity gaps by expanding collision boxes (obstacles)
 * to encompass as much area of ignorable neighbors as possible. This solver runs after
 * StrawSolver and processes nodes marked with _containsObstacle: true that overlap with
 * _isIgnorable nodes.
 *
 * The solver only operates on layer 0 (top layer) where SMTP pads are typically located.
 * It expands collision boxes to include ignorable nodes while avoiding conflicts with
 * valid (non-ignorable) nodes.
 *
 * @example
 * ```typescript
 * const solver = new CollisionBoxExpander(nodes)
 * solver.solve()
 * const expandedNodes = solver.expandedNodes
 * ```
 */
export class CollisionBoxExpander extends BaseSolver {
  public expandedNodes: CapacityMeshNode[] = []
  private unprocessedNodes: CapacityMeshNode[]
  private originalNodes: CapacityMeshNode[]
  private options: Required<CollisionBoxExpanderOptions>
  private removedIgnorableNodeIds: Set<string> = new Set()

  constructor(
    nodes: CapacityMeshNode[],
    options: CollisionBoxExpanderOptions = {},
  ) {
    super()
    this.unprocessedNodes = [...nodes] // Create copy for processing
    this.originalNodes = [...nodes] // Create copy to preserve originals for comparison
    this.options = options // No parameters currently, but kept for future extensibility
    this.MAX_ITERATIONS = nodes.length + 1 // One iteration per node + final iteration
  }

  /**
   * Processes collision boxes and expands them to encompass ignorable neighbors
   * Processes all nodes normally while expanding collision boxes and tracking removals
   */
  _step(): void {
    const currentNode = this.unprocessedNodes.pop()

    if (!currentNode) {
      this.solved = true
      return
    }

    // Process collision boxes on layer 0 - expand to encompass ignorable neighbors
    if (currentNode._containsObstacle && currentNode.availableZ.includes(0)) {
      const expandedNode = expandCollisionBoxToConnect(
        currentNode,
        this.expandedNodes.concat(this.unprocessedNodes), // All nodes for neighbor checking
      )
      this.expandedNodes.push(expandedNode)
      return
    }

    this.expandedNodes.push(currentNode)
  }

  /**
   * Returns all nodes after expansion processing, excluding ignorable nodes that were removed
   */
  getAllNodes(): CapacityMeshNode[] {
    const nodes = this.expandedNodes.filter((node) => !node._isIgnorable)

    return nodes
  }

  /**
   * Returns nodes that were actually expanded (size changed)
   */
  getExpandedNodes(): CapacityMeshNode[] {
    // Compare expanded nodes with original processing order to find actual expansions
    // Since we process in reverse order (pop from end), we need to track by node ID
    return this.expandedNodes.filter((expandedNode) => {
      if (
        !expandedNode._containsObstacle ||
        !expandedNode.availableZ.includes(0)
      ) {
        return false
      }

      // Check if this collision box was actually expanded by comparing with original
      const originalNode = this.originalNodes.find(
        (orig: CapacityMeshNode) =>
          orig.capacityMeshNodeId === expandedNode.capacityMeshNodeId,
      )

      if (!originalNode) return false

      // If size changed, it was expanded
      return (
        expandedNode.width !== originalNode.width ||
        expandedNode.height !== originalNode.height
      )
    })
  }

  /**
   * Returns statistics about the expansion process
   */
  getExpansionStats(): {
    totalNodes: number
    expandedNodes: number
    collisionBoxesProcessed: number
    removedIgnorableNodes: number
    averageExpansion: { width: number; height: number }
  } {
    const expanded = this.getExpandedNodes()
    const collisionBoxes = this.expandedNodes.filter(
      (node) => node._containsObstacle && node.availableZ.includes(0),
    )

    return {
      totalNodes: this.expandedNodes.length,
      expandedNodes: expanded.length,
      collisionBoxesProcessed: collisionBoxes.length,
      removedIgnorableNodes: this.removedIgnorableNodeIds.size,
      averageExpansion: {
        width: 0, // TODO: Implement proper expansion tracking
        height: 0, // TODO: Implement proper expansion tracking
      },
    }
  }

  private isNodeEncompassedByCollisionBox(
    ignorableNode: CapacityMeshNode,
    collisionBox: CapacityMeshNode,
  ): boolean {
    const ignorableLeft = ignorableNode.center.x - ignorableNode.width / 2
    const ignorableRight = ignorableNode.center.x + ignorableNode.width / 2
    const ignorableTop = ignorableNode.center.y - ignorableNode.height / 2
    const ignorableBottom = ignorableNode.center.y + ignorableNode.height / 2

    const collisionLeft = collisionBox.center.x - collisionBox.width / 2
    const collisionRight = collisionBox.center.x + collisionBox.width / 2
    const collisionTop = collisionBox.center.y - collisionBox.height / 2
    const collisionBottom = collisionBox.center.y + collisionBox.height / 2

    // Check if ignorable node is completely encompassed by collision box
    return (
      ignorableLeft >= collisionLeft &&
      ignorableRight <= collisionRight &&
      ignorableTop >= collisionTop &&
      ignorableBottom <= collisionBottom
    )
  }

  /**
   * Visualizes the expansion results showing all nodes for pipeline consumption
   * Highlights expanded collision boxes and shows processing statistics
   */
  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      rects: [],
      lines: [],
      points: [],
      circles: [],
      title: "Collision Box Expander - Complete Node List",
    }

    // Show all nodes in the final output - suitable for pipeline consumption
    for (const node of this.expandedNodes) {
      if (node._containsObstacle && node.availableZ.includes(0)) {
        // This is a collision box on layer 0 that may have expanded
        const wasExpanded = this.getExpandedNodes().some(
          (expanded) => expanded.capacityMeshNodeId === node.capacityMeshNodeId,
        )

        graphics.rects!.push({
          center: node.center,
          width: node.width,
          height: node.height,
          fill: wasExpanded ? "rgba(255, 100, 0, 0.6)" : "rgba(255, 0, 0, 0.4)",
          stroke: wasExpanded ? "rgba(255, 150, 0, 1)" : "rgba(200, 0, 0, 0.8)",
          label: `Collision${wasExpanded ? " (Expanded)" : ""}\n${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
          layer: "z0",
        })
      } else if ((node as any)._isIgnorable && node.availableZ.includes(0)) {
        // This is an ignorable node on layer 0 that wasn't removed
        graphics.rects!.push({
          center: node.center,
          width: node.width,
          height: node.height,
          fill: "rgba(200, 200, 200, 0.3)",
          stroke: "rgba(150, 150, 150, 0.5)",
          label: `Ignorable\n${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
          layer: "z0",
        })
      } else {
        // All other nodes (non-collision, non-ignorable, other layers)
        graphics.rects!.push({
          center: node.center,
          width: node.width,
          height: node.height,
          fill: "rgba(100, 150, 255, 0.2)",
          stroke: "rgba(50, 100, 200, 0.4)",
          label: `${node._containsObstacle ? "Obstacle" : "Node"}\n${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
          layer: `z${node.availableZ.join(",")}`,
        })
      }
    }

    // Add summary statistics
    const stats = this.getExpansionStats()
    graphics.points!.push({
      x: 0,
      y: 0,
      label: `Processed: ${stats.totalNodes} nodes, ${stats.expandedNodes} expanded, ${stats.removedIgnorableNodes} ignorable removed`,
      color: "rgba(0, 150, 0, 1)",
      layer: "info",
    })

    return graphics
  }
}

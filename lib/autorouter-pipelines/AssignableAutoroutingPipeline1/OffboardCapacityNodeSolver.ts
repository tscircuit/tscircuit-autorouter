import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshEdge, CapacityMeshNode } from "lib/types"
import type { Obstacle } from "lib/types/srj-types"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { createNodeMap } from "lib/utils/createNodeMap"
import { getMidpoint } from "lib/utils/getMidpoint"

type AnimationState = "showing_nodes" | "showing_edges" | "done"

/**
 * Creates offboard edges between assignable via obstacles that share
 * the same `offBoardConnectsTo` net name. These obstacles represent off-board
 * connection points (like edge connectors) that are logically connected
 * through external wiring.
 *
 * The solver finds all capacity nodes with `_assignedViaObstacle.offBoardConnectsTo`,
 * groups them by net name, and creates zero-cost offboard edges between
 * matching nodes. This allows the pathing solver to route through these virtual
 * connections as if the obstacles were directly connected.
 */
export class OffboardCapacityNodeSolver extends BaseSolver {
  capacityNodes: CapacityMeshNode[]
  capacityEdges: CapacityMeshEdge[]

  enhancedEdges: CapacityMeshEdge[] = []

  // Animation state
  private animationState: AnimationState = "showing_nodes"

  // Nodes to show (assignable obstacle nodes)
  private assignableNodes: CapacityMeshNode[] = []
  private shownNodes: CapacityMeshNode[] = []

  // Edges to create
  private pendingEdges: Array<{
    node1: CapacityMeshNode
    node2: CapacityMeshNode
    netName: string
  }> = []
  private createdEdges: CapacityMeshEdge[] = []

  private nextEdgeId = 0

  // Node map for O(1) lookups
  private nodeMap: Map<string, CapacityMeshNode> = new Map()

  constructor(solverParams: {
    capacityNodes: CapacityMeshNode[]
    capacityEdges: CapacityMeshEdge[]
  }) {
    super()
    this.capacityNodes = solverParams.capacityNodes
    this.capacityEdges = solverParams.capacityEdges

    // Build node map for O(1) lookups
    this.nodeMap = createNodeMap(this.capacityNodes)

    // Initialize enhanced edges
    this.enhancedEdges = [...this.capacityEdges]

    // Find all assignable obstacle nodes
    this.initializeAssignableNodes()

    // Prepare edges to create
    this.initializePendingEdges()

    // Set MAX_ITERATIONS based on actual work needed
    // Need: assignableNodes.length steps for nodes + pendingEdges.length steps for edges + buffer
    this.MAX_ITERATIONS =
      this.assignableNodes.length + this.pendingEdges.length + 10
  }

  private initializeAssignableNodes(): void {
    for (const node of this.capacityNodes) {
      const assignedObstacle = (node as any)._assignedViaObstacle as
        | Obstacle
        | undefined
      if (
        assignedObstacle?.offBoardConnectsTo &&
        assignedObstacle.offBoardConnectsTo.length > 0
      ) {
        this.assignableNodes.push(node)
      }
    }
  }

  private initializePendingEdges(): void {
    // Group assignable obstacle nodes by their offBoardConnectsTo values
    const offboardGroups = new Map<string, CapacityMeshNode[]>()

    for (const node of this.assignableNodes) {
      const assignedObstacle = (node as any)._assignedViaObstacle as Obstacle
      if (assignedObstacle?.offBoardConnectsTo) {
        for (const netName of assignedObstacle.offBoardConnectsTo) {
          if (!offboardGroups.has(netName)) {
            offboardGroups.set(netName, [])
          }
          offboardGroups.get(netName)!.push(node)
        }
      }
    }

    // Create direct connections between all nodes in each group
    this.pendingEdges = []
    for (const [netName, obstacleNodes] of offboardGroups) {
      if (obstacleNodes.length > 1) {
        for (let i = 0; i < obstacleNodes.length; i++) {
          for (let j = i + 1; j < obstacleNodes.length; j++) {
            this.pendingEdges.push({
              node1: obstacleNodes[i],
              node2: obstacleNodes[j],
              netName,
            })
          }
        }
      }
    }
  }

  _step(): void {
    switch (this.animationState) {
      case "showing_nodes": {
        if (this.assignableNodes.length > 0) {
          // Show one node at a time
          const node = this.assignableNodes.shift()!
          this.shownNodes.push(node)
        } else {
          // All nodes shown, move to edges
          this.animationState = "showing_edges"
        }
        break
      }

      case "showing_edges": {
        if (this.pendingEdges.length > 0) {
          // Create one edge at a time
          const { node1, node2, netName } = this.pendingEdges.shift()!
          const edge = this.createOffboardEdge(node1, node2, netName)
          this.enhancedEdges.push(edge)
          this.createdEdges.push(edge)
        } else {
          // All edges created
          this.animationState = "done"
          this.solved = true
        }
        break
      }

      case "done": {
        this.solved = true
        break
      }
    }
  }

  private createOffboardEdge(
    node1: CapacityMeshNode,
    node2: CapacityMeshNode,
    netName: string,
  ): CapacityMeshEdge {
    return {
      capacityMeshEdgeId: `offboard_${this.nextEdgeId++}`,
      nodeIds: [node1.capacityMeshNodeId, node2.capacityMeshNodeId],
      isOffboardEdge: true,
      offboardNetName: netName,
    }
  }

  visualize(): GraphicsObject {
    const lines: any[] = []
    const points: any[] = []
    const rects: any[] = []

    // Build a set of shown node IDs for quick lookup
    const shownNodeIds = new Set(
      this.shownNodes.map((n) => n.capacityMeshNodeId),
    )

    // Draw neighbor connections (edges connecting to shown assignable nodes)
    for (const edge of this.capacityEdges) {
      if (edge.isOffboardEdge) continue // Skip offboard edges

      const connectsToShownNode =
        shownNodeIds.has(edge.nodeIds[0]) || shownNodeIds.has(edge.nodeIds[1])

      if (connectsToShownNode) {
        const node1 = this.nodeMap.get(edge.nodeIds[0])
        const node2 = this.nodeMap.get(edge.nodeIds[1])

        if (node1 && node2) {
          lines.push({
            points: [node1.center, node2.center],
            strokeColor: "rgba(0, 200, 0, 0.5)",
            strokeWidth: 0.05,
          })
        }
      }
    }

    // Draw shown nodes (assignable obstacle rectangles)
    for (let i = 0; i < this.shownNodes.length; i++) {
      const node = this.shownNodes[i]
      const assignedObstacle = (node as any)._assignedViaObstacle as Obstacle
      const isNewest =
        i === this.shownNodes.length - 1 &&
        this.animationState === "showing_nodes"

      // Rectangle for the node
      rects.push({
        center: node.center,
        width: node.width,
        height: node.height,
        fill: isNewest ? "rgba(255, 165, 0, 0.5)" : "rgba(173, 216, 230, 0.5)",
        stroke: isNewest ? "orange" : "blue",
        strokeWidth: isNewest ? 0.15 : 0.1,
      })

      // Label
      points.push({
        x: node.center.x,
        y: node.center.y,
        color: isNewest ? "orange" : "blue",
        label: `${isNewest ? "NEW: " : ""}${node.capacityMeshNodeId}\n${assignedObstacle?.offBoardConnectsTo?.join(", ") || ""}`,
      })
    }

    // Draw created offboard edges
    for (let i = 0; i < this.createdEdges.length; i++) {
      const edge = this.createdEdges[i]
      const isNewest =
        i === this.createdEdges.length - 1 &&
        this.animationState === "showing_edges"

      const node1 = this.nodeMap.get(edge.nodeIds[0])
      const node2 = this.nodeMap.get(edge.nodeIds[1])

      if (node1 && node2) {
        // Edge line
        lines.push({
          points: [node1.center, node2.center],
          strokeColor: isNewest ? "red" : "orange",
          strokeWidth: isNewest ? 0.2 : 0.1,
          strokeDasharray: "0.3,0.15",
        })

        // Midpoint label
        const midpoint = getMidpoint(node1.center, node2.center)

        points.push({
          x: midpoint.x,
          y: midpoint.y,
          color: isNewest ? "red" : "orange",
          label: `${isNewest ? "NEW: " : ""}⚡ ${edge.offboardNetName}`,
        })
      }
    }

    // Build title based on state
    let title = "Offboard Capacity Node Solver"
    switch (this.animationState) {
      case "showing_nodes":
        title += ` - Showing nodes (${this.shownNodes.length}/${this.shownNodes.length + this.assignableNodes.length})`
        break
      case "showing_edges":
        title += ` - Creating edges (${this.createdEdges.length}/${this.createdEdges.length + this.pendingEdges.length})`
        break
      case "done":
        title += ` - Done (${this.shownNodes.length} nodes, ${this.createdEdges.length} edges)`
        break
    }

    return {
      lines,
      points,
      rects,
      title,
    }
  }

  getVirtualOffboardNodes(): CapacityMeshNode[] {
    return []
  }

  getOffboardEdges(): CapacityMeshEdge[] {
    return this.enhancedEdges.filter((edge) => edge.isOffboardEdge)
  }
}

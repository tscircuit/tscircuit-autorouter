import type { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "../../types/capacity-mesh-types"
import { BaseSolver } from "../BaseSolver"
import { distance } from "@tscircuit/math-utils"
import { areNodesBordering } from "lib/utils/areNodesBordering"

export class CapacityMeshEdgeSolver extends BaseSolver {
  override getSolverName(): string {
    return "CapacityMeshEdgeSolver"
  }

  public edges: Array<CapacityMeshEdge>

  /** Only used for visualization, dynamically instantiated if necessary */
  nodeMap?: Map<CapacityMeshNodeId, CapacityMeshNode>

  constructor(public nodes: CapacityMeshNode[]) {
    super()
    this.edges = []
  }

  getNextCapacityMeshEdgeId() {
    return `ce${this.edges.length}`
  }

  _step() {
    this.edges = []
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const strawNodesWithSameParent =
          this.nodes[i]._strawNode &&
          this.nodes[j]._strawNode &&
          this.nodes[i]._strawParentCapacityMeshNodeId ===
            this.nodes[j]._strawParentCapacityMeshNodeId
        if (
          !strawNodesWithSameParent &&
          areNodesBordering(this.nodes[i], this.nodes[j]) &&
          this.doNodesHaveSharedLayer(this.nodes[i], this.nodes[j])
        ) {
          this.edges.push({
            capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
            nodeIds: [
              this.nodes[i].capacityMeshNodeId,
              this.nodes[j].capacityMeshNodeId,
            ],
          })
        }
      }
    }

    this.handleTargetNodes()

    this.solved = true
  }

  handleTargetNodes() {
    // If a target node is not connected to any other node, then it is "inside
    // an obstacle" (this is the case almost 100% of the time when we place
    // targets inside of PCB pads)
    // To fix this we connect it to the nearest nodes without obstacles
    const targetNodes = this.nodes.filter((node) => node._containsTarget)
    for (const targetNode of targetNodes) {
      const hasEdge = this.edges.some((edge) =>
        edge.nodeIds.includes(targetNode.capacityMeshNodeId),
      )
      if (hasEdge) continue

      let nearestNode: CapacityMeshNode | null = null
      let nearestDistance = Infinity
      for (const node of this.nodes) {
        if (node._containsObstacle) continue
        if (node._containsTarget) continue
        const dist = distance(targetNode.center, node.center)
        if (dist < nearestDistance) {
          nearestDistance = dist
          nearestNode = node
        }
      }
      if (nearestNode) {
        this.edges.push({
          capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
          nodeIds: [
            targetNode.capacityMeshNodeId,
            nearestNode.capacityMeshNodeId,
          ],
        })
      }
    }
  }

  doNodesHaveSharedLayer(
    node1: CapacityMeshNode,
    node2: CapacityMeshNode,
  ): boolean {
    return node1.availableZ.some((z) => node2.availableZ.includes(z))
  }

  visualize(): GraphicsObject {
    const edgeCount = new Map<string, number>()

    for (const edge of this.edges) {
      for (const nodeId of edge.nodeIds) {
        edgeCount.set(nodeId, 1 + (edgeCount.get(nodeId) ?? 0))
      }
    }

    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: this.nodes.map((node) => {
        const lowestZ = Math.min(...node.availableZ)
        return {
          width: Math.max(node.width - 2, node.width * 0.8),
          height: Math.max(node.height - 2, node.height * 0.8),
          center: {
            x: node.center.x + lowestZ * node.width * 0.05,
            y: node.center.y - lowestZ * node.width * 0.05,
          },
          fill: node._containsObstacle
            ? "rgba(255,0,0,0.1)"
            : ({
                "0,1": "rgba(0,0,0,0.1)",
                "0": "rgba(0,200,200, 0.1)",
                "1": "rgba(0,0,200, 0.1)",
              }[node.availableZ.join(",")] ?? "rgba(0,200,200,0.1)"),
          label: [
            node.capacityMeshNodeId,
            `availableZ: ${node.availableZ.join(",")}`,
            `target? ${node._containsTarget ?? false}`,
            `obs? ${node._containsObstacle ?? false}`,
            `conn: ${edgeCount.get(node.capacityMeshNodeId) ?? 0}`,
          ].join("\n"),
          layer: `z${node.availableZ.join(",")}`,
        }
      }),
      circles: [],
    }
    if (!this.nodeMap) {
      this.nodeMap = new Map<CapacityMeshNodeId, CapacityMeshNode>()
      for (const node of this.nodes) {
        this.nodeMap.set(node.capacityMeshNodeId, node)
      }
    }

    for (const edge of this.edges) {
      const node1 = this.nodeMap.get(edge.nodeIds[0])
      const node2 = this.nodeMap.get(edge.nodeIds[1])
      if (node1?.center && node2?.center) {
        const lowestZ1 = Math.min(...node1.availableZ)
        const lowestZ2 = Math.min(...node2.availableZ)
        const nodeCenter1Adj = {
          x: node1.center.x + lowestZ1 * node1.width * 0.05,
          y: node1.center.y - lowestZ1 * node1.width * 0.05,
        }
        const nodeCenter2Adj = {
          x: node2.center.x + lowestZ2 * node2.width * 0.05,
          y: node2.center.y - lowestZ2 * node2.width * 0.05,
        }

        const availableZ = Array.from(
          new Set([...node1.availableZ, ...node2.availableZ]),
        ).sort()

        graphics.lines!.push({
          layer: `z${availableZ.join(",")}`,
          points: [nodeCenter1Adj, nodeCenter2Adj],
          strokeDash:
            node1.availableZ.join(",") === node2.availableZ.join(",")
              ? undefined
              : "10 5",
        })
      }
    }
    return graphics
  }
}

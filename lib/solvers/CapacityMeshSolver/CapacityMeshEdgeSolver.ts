import type { GraphicsObject } from "graphics-debug"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "../../types/capacity-mesh-types"
import { BaseSolver } from "../BaseSolver"
import { hasViaAccessOverlap } from "../NodeDimensionSubdivisionSolver/add-target-via-access-layers"

export class CapacityMeshEdgeSolver extends BaseSolver {
  override getSolverName(): string {
    return "CapacityMeshEdgeSolver"
  }

  public edges: Array<CapacityMeshEdge>

  /** Only used for visualization, dynamically instantiated if necessary */
  nodeMap?: Map<CapacityMeshNodeId, CapacityMeshNode>

  constructor(
    public nodes: CapacityMeshNode[],
    public viaDiameter?: number,
  ) {
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
          (areNodesBordering(this.nodes[i], this.nodes[j]) ||
            hasViaAccessOverlap(
              this.nodes[i],
              this.nodes[j],
              this.viaDiameter,
            )) &&
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
    const targetNodes = this.nodes.filter((node) => node._containsTarget)
    const nodeById = new Map(
      this.nodes.map((node) => [node.capacityMeshNodeId, node]),
    )

    for (let i = 0; i < targetNodes.length; i++) {
      for (let j = i + 1; j < targetNodes.length; j++) {
        const nodeA = targetNodes[i]!
        const nodeB = targetNodes[j]!
        if (!this.doNodesHaveSharedLayer(nodeA, nodeB)) continue
        if (!this.doNodesTouchOrOverlap(nodeA, nodeB)) continue
        if (this.hasEdgeBetween(nodeA, nodeB)) continue

        this.edges.push({
          capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
          nodeIds: [nodeA.capacityMeshNodeId, nodeB.capacityMeshNodeId],
        })
      }
    }

    for (const targetNode of targetNodes) {
      if (!targetNode._containsObstacle || !targetNode._targetConnectionName) {
        continue
      }

      const hasRoutingEdge = this.edges.some((edge) => {
        if (!edge.nodeIds.includes(targetNode.capacityMeshNodeId)) return false
        const otherNodeId =
          edge.nodeIds[0] === targetNode.capacityMeshNodeId
            ? edge.nodeIds[1]
            : edge.nodeIds[0]
        const otherNode = nodeById.get(otherNodeId)
        if (!otherNode) return false

        return (
          !otherNode._containsObstacle &&
          !otherNode._containsTarget &&
          this.doNodesHaveSharedLayer(targetNode, otherNode)
        )
      })
      if (hasRoutingEdge) continue

      throw new Error(
        `Target obstacle region "${targetNode.capacityMeshNodeId}" for connection "${targetNode._targetConnectionName}" has no bordering routing edge`,
      )
    }
  }

  doNodesHaveSharedLayer(
    node1: CapacityMeshNode,
    node2: CapacityMeshNode,
  ): boolean {
    return node1.availableZ.some((z) => node2.availableZ.includes(z))
  }

  hasEdgeBetween(node1: CapacityMeshNode, node2: CapacityMeshNode): boolean {
    return this.edges.some(
      (edge) =>
        edge.nodeIds.includes(node1.capacityMeshNodeId) &&
        edge.nodeIds.includes(node2.capacityMeshNodeId),
    )
  }

  doNodesTouchOrOverlap(
    node1: CapacityMeshNode,
    node2: CapacityMeshNode,
  ): boolean {
    const epsilon = 0.001
    const n1Left = node1.center.x - node1.width / 2
    const n1Right = node1.center.x + node1.width / 2
    const n1Top = node1.center.y - node1.height / 2
    const n1Bottom = node1.center.y + node1.height / 2
    const n2Left = node2.center.x - node2.width / 2
    const n2Right = node2.center.x + node2.width / 2
    const n2Top = node2.center.y - node2.height / 2
    const n2Bottom = node2.center.y + node2.height / 2

    return (
      n1Left <= n2Right + epsilon &&
      n1Right + epsilon >= n2Left &&
      n1Top <= n2Bottom + epsilon &&
      n1Bottom + epsilon >= n2Top
    )
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

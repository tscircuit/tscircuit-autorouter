import Flatbush from "flatbush"
import type { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "../../types/capacity-mesh-types"
import { BaseSolver } from "../BaseSolver"
import { areNodesBordering } from "lib/utils/areNodesBordering"

const TARGET_NODE_TOUCH_EPSILON = 0.001

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

  handleTargetNodes(): void {
    const targetNodes = this.nodes.filter((node) => node._containsTarget)
    if (targetNodes.length === 0) return

    const targetNodeIndex = new Flatbush(targetNodes.length)
    for (const targetNode of targetNodes) {
      targetNodeIndex.add(
        targetNode.center.x - targetNode.width / 2,
        targetNode.center.y - targetNode.height / 2,
        targetNode.center.x + targetNode.width / 2,
        targetNode.center.y + targetNode.height / 2,
      )
    }
    targetNodeIndex.finish()

    const nodeById = new Map(
      this.nodes.map((node) => [node.capacityMeshNodeId, node]),
    )
    const connectedNodeIdsByTargetNodeId = new Map<
      CapacityMeshNodeId,
      Set<CapacityMeshNodeId>
    >(
      targetNodes.map((targetNode) => [
        targetNode.capacityMeshNodeId,
        new Set<CapacityMeshNodeId>(),
      ]),
    )

    for (const edge of this.edges) {
      const [nodeAId, nodeBId] = edge.nodeIds
      connectedNodeIdsByTargetNodeId.get(nodeAId)?.add(nodeBId)
      connectedNodeIdsByTargetNodeId.get(nodeBId)?.add(nodeAId)
    }

    for (let i = 0; i < targetNodes.length; i++) {
      const nodeA = targetNodes[i]!
      const candidateTargetNodeIndexes = targetNodeIndex
        .search(
          nodeA.center.x - nodeA.width / 2 - TARGET_NODE_TOUCH_EPSILON,
          nodeA.center.y - nodeA.height / 2 - TARGET_NODE_TOUCH_EPSILON,
          nodeA.center.x + nodeA.width / 2 + TARGET_NODE_TOUCH_EPSILON,
          nodeA.center.y + nodeA.height / 2 + TARGET_NODE_TOUCH_EPSILON,
        )
        .filter((targetNodeIndex) => targetNodeIndex > i)
        .sort((a, b) => a - b)

      for (const targetNodeIndex of candidateTargetNodeIndexes) {
        const nodeB = targetNodes[targetNodeIndex]!
        if (!this.doNodesHaveSharedLayer(nodeA, nodeB)) continue
        if (!this.doNodesTouchOrOverlap(nodeA, nodeB)) continue
        if (
          connectedNodeIdsByTargetNodeId
            .get(nodeA.capacityMeshNodeId)!
            .has(nodeB.capacityMeshNodeId)
        ) {
          continue
        }

        this.edges.push({
          capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
          nodeIds: [nodeA.capacityMeshNodeId, nodeB.capacityMeshNodeId],
        })
        connectedNodeIdsByTargetNodeId
          .get(nodeA.capacityMeshNodeId)!
          .add(nodeB.capacityMeshNodeId)
        connectedNodeIdsByTargetNodeId
          .get(nodeB.capacityMeshNodeId)!
          .add(nodeA.capacityMeshNodeId)
      }
    }

    for (const targetNode of targetNodes) {
      if (!targetNode._containsObstacle || !targetNode._targetConnectionName) {
        continue
      }

      const hasRoutingEdge = [
        ...connectedNodeIdsByTargetNodeId.get(
          targetNode.capacityMeshNodeId,
        )!,
      ].some((connectedNodeId) => {
        const otherNode = nodeById.get(connectedNodeId)
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

  doNodesTouchOrOverlap(
    node1: CapacityMeshNode,
    node2: CapacityMeshNode,
  ): boolean {
    const n1Left = node1.center.x - node1.width / 2
    const n1Right = node1.center.x + node1.width / 2
    const n1Top = node1.center.y - node1.height / 2
    const n1Bottom = node1.center.y + node1.height / 2
    const n2Left = node2.center.x - node2.width / 2
    const n2Right = node2.center.x + node2.width / 2
    const n2Top = node2.center.y - node2.height / 2
    const n2Bottom = node2.center.y + node2.height / 2

    return (
      n1Left <= n2Right + TARGET_NODE_TOUCH_EPSILON &&
      n1Right + TARGET_NODE_TOUCH_EPSILON >= n2Left &&
      n1Top <= n2Bottom + TARGET_NODE_TOUCH_EPSILON &&
      n1Bottom + TARGET_NODE_TOUCH_EPSILON >= n2Top
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

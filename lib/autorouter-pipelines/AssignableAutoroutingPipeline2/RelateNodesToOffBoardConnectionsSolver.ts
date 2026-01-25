import { BaseSolver } from "lib/solvers/BaseSolver"
import {
  CapacityMeshNode,
  CapacityMeshNodeId,
  Obstacle,
  OffBoardConnectionId,
  SimpleRouteJson,
} from "lib/types"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"
import { ConnectivityMap } from "connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { getStringColor } from "lib/solvers/colors"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/**
 * This solver looks at every obstacle with off board connections (one per step),
 * then sets _offBoardConnectedCapacityMeshNodeIds on each capacity node that is
 * mutually connected via off board connections
 */
export class RelateNodesToOffBoardConnectionsSolver extends BaseSolver {
  override getSolverName(): string {
    return "RelateNodesToOffBoardConnectionsSolver"
  }

  unprocessedObstacles: Obstacle[]
  nodeTree: CapacityNodeTree

  offBoardConnMap: ConnectivityMap

  nodesInNet: Map<OffBoardConnectionId, CapacityMeshNode[]> = new Map()

  lastProcessedObstacle?: Obstacle

  constructor(
    public input: {
      capacityMeshNodes: CapacityMeshNode[]
      srj: SimpleRouteJson
    },
  ) {
    super()

    this.unprocessedObstacles = this.input.srj.obstacles.filter(
      (obstacle) =>
        obstacle.offBoardConnectsTo && obstacle.offBoardConnectsTo.length > 0,
    )

    this.unprocessedObstacles.forEach((o, i) => {
      o.obstacleId = o.obstacleId ?? `__obs${i}`
      o.zLayers =
        o.zLayers ??
        o.layers.map((layer) =>
          mapLayerNameToZ(layer, this.input.srj.layerCount),
        )
    })

    this.offBoardConnMap = new ConnectivityMap({})
    this.offBoardConnMap.addConnections(
      this.unprocessedObstacles
        .filter((o) => o.offBoardConnectsTo?.length)
        .map((o) => [o.obstacleId!, ...(o.offBoardConnectsTo ?? [])]),
    )

    // Create a sptial hash with all capacity nodes
    this.nodeTree = new CapacityNodeTree(this.input.capacityMeshNodes)
  }

  _step() {
    const obstacle = this.unprocessedObstacles.pop()
    this.lastProcessedObstacle = obstacle
    if (!obstacle) {
      this.solved = true
      return
    }

    const offBoardConnId = this.offBoardConnMap.getNetConnectedToId(
      obstacle.obstacleId!,
    )!
    const nodesNearObstacle = this.nodeTree
      .getNodesInArea(obstacle.center.x, obstacle.center.y, 0.01, 0.01)
      .filter((n) => n.availableZ.some((z) => obstacle.zLayers?.includes(z)))
      .filter(
        (n) =>
          Math.abs(n.center.x - obstacle.center.x) < 0.01 &&
          Math.abs(n.center.y - obstacle.center.y) < 0.01,
      )

    // TODO ignoring layers for now

    const nodesToAddToNet = nodesNearObstacle
    const newNodeIds = nodesToAddToNet.map((n) => n.capacityMeshNodeId)
    const existingNodesInNet = this.nodesInNet.get(offBoardConnId) ?? []
    const existingNodeIds = existingNodesInNet.map((n) => n.capacityMeshNodeId)

    const allNodeIdsInNet = [...existingNodeIds, ...newNodeIds]

    for (const existingNode of existingNodesInNet) {
      existingNode._offBoardConnectedCapacityMeshNodeIds = allNodeIdsInNet
    }
    for (const newNode of nodesToAddToNet) {
      newNode._offBoardConnectedCapacityMeshNodeIds = allNodeIdsInNet
      newNode._offBoardConnectionId = offBoardConnId
    }

    this.nodesInNet.set(offBoardConnId, [
      ...existingNodesInNet,
      ...nodesToAddToNet,
    ])
  }

  getOutput() {
    return {
      // we're currently modifying the input capacity nodes, but in the
      // future we should POSSIBLY avoid mutating
      capacityNodes: this.input.capacityMeshNodes,
    }
  }

  visualize() {
    const graphics: GraphicsObject = {
      rects: [],
      lines: [],
      points: [],
      circles: [],
    }

    const nodesLinkedToOffBoardConnections = new Set<CapacityMeshNodeId>()
    for (const [offBoardConnId, nodes] of this.nodesInNet) {
      for (const node of nodes) {
        nodesLinkedToOffBoardConnections.add(node.capacityMeshNodeId)
      }
    }

    // Draw all nodes in gray
    for (const node of this.input.capacityMeshNodes) {
      if (nodesLinkedToOffBoardConnections.has(node.capacityMeshNodeId))
        continue
      graphics.rects!.push({
        center: node.center,
        width: node.width - 0.1,
        height: node.height - 0.1,
        fill: "rgba(0, 0, 0, 0.2)",
      })
    }

    if (this.lastProcessedObstacle) {
      graphics.rects!.push({
        center: this.lastProcessedObstacle.center,
        width: this.lastProcessedObstacle.width,
        height: this.lastProcessedObstacle.height,
        fill: "rgba(255, 0, 0, 0.5)",
      })
    }

    for (const [offBoardConnId, nodes] of this.nodesInNet.entries()) {
      for (const node of nodes) {
        graphics.rects!.push({
          center: node.center,
          width: node.width,
          height: node.height,
          fill: getStringColor(offBoardConnId, 0.2),
          label: `OffBoardConn: ${offBoardConnId}`,
        })
      }

      // Draw lines between all nodes in the net
      for (const node of nodes) {
        for (const otherNode of nodes) {
          if (node.capacityMeshNodeId === otherNode.capacityMeshNodeId) continue
          graphics.lines!.push({
            points: [node.center, otherNode.center],
            strokeColor: getStringColor(offBoardConnId, 1),
          })
        }
      }
    }

    return graphics
  }
}

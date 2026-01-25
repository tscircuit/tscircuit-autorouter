import {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
} from "lib/types"
import { Obstacle } from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { doRectsOverlap } from "lib/utils/doRectsOverlap"
import { isPointInRect } from "lib/utils/isPointInRect"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { areNodesBordering } from "lib/utils/areNodesBordering"

export class CapacityNodeTargetMerger2 extends BaseSolver {
  override getSolverName(): string {
    return "CapacityNodeTargetMerger2"
  }

  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  currentBatchNodeIds: CapacityMeshNodeId[]
  nextBatchNodeIds: CapacityMeshNodeId[]

  absorbedNodeIds: Set<CapacityMeshNodeId>
  batchHadModifications: boolean

  newNodes: CapacityMeshNode[]
  obstacles: Obstacle[]

  // Small value for floating point comparisons
  EPSILON = 0.005

  constructor(
    public nodes: CapacityMeshNode[],
    obstacles: Obstacle[],
    public connMap: ConnectivityMap,
    public colorMap?: Record<string, string>,
    public connections?: SimpleRouteConnection[],
  ) {
    super()
    this.MAX_ITERATIONS = 100_000
    this.obstacles = [...obstacles]
    this.nodeMap = new Map()
    this.absorbedNodeIds = new Set()
    this.newNodes = []
    this.batchHadModifications = false

    // Initialize node map
    for (const node of nodes) {
      this.nodeMap.set(node.capacityMeshNodeId, node)
    }

    // Sort nodes by area (smallest to largest)
    const nodesWithArea: Array<[string, number]> = []
    for (const node of nodes) {
      nodesWithArea.push([node.capacityMeshNodeId, node.width * node.height])
    }
    nodesWithArea.sort((a, b) => a[1] - b[1])

    this.currentBatchNodeIds = nodesWithArea.map((n) => n[0])
    this.nextBatchNodeIds = []
  }

  getAdjacentConnectedNodes(rootNode: CapacityMeshNode): CapacityMeshNode[] {
    const adjacentNodes: CapacityMeshNode[] = []

    for (const nodeId of this.currentBatchNodeIds) {
      if (this.absorbedNodeIds.has(nodeId)) continue

      const candidateNode = this.nodeMap.get(nodeId)!

      // Skip the root node itself
      if (candidateNode.capacityMeshNodeId === rootNode.capacityMeshNodeId)
        continue

      // Check if nodes are bordering
      if (!areNodesBordering(rootNode, candidateNode)) continue

      // Check if nodes are electrically connected - either:
      // 1. They are connected through the connectivity map
      // 2. They are part of the same target connection
      const areConnected =
        // Both nodes have target connection names and they match
        (rootNode._targetConnectionName &&
          candidateNode._targetConnectionName &&
          rootNode._targetConnectionName ===
            candidateNode._targetConnectionName) ||
        // Or they are connected in the connectivity map
        (rootNode._targetConnectionName &&
          candidateNode._targetConnectionName &&
          this.connMap.areIdsConnected(
            rootNode._targetConnectionName,
            candidateNode._targetConnectionName,
          ))

      if (areConnected) {
        adjacentNodes.push(candidateNode)
      }
    }

    return adjacentNodes
  }

  _step() {
    let rootNodeId = this.currentBatchNodeIds.pop()
    while (rootNodeId && this.absorbedNodeIds.has(rootNodeId)) {
      rootNodeId = this.currentBatchNodeIds.pop()
    }

    if (!rootNodeId) {
      if (this.batchHadModifications) {
        // Sort next batch nodes by size for next iteration
        this.currentBatchNodeIds = this.nextBatchNodeIds.sort((a, b) => {
          const A = this.nodeMap.get(a)!
          const B = this.nodeMap.get(b)!
          return A.width * A.height - B.width * B.height
        })
        this.nextBatchNodeIds = []
        this.batchHadModifications = false
        return
      }

      // We're done - add all remaining nodes to newNodes
      this.solved = true
      this.newNodes.push(
        ...this.nextBatchNodeIds.map((id) => this.nodeMap.get(id)!),
      )
      return
    }

    const rootNode = this.nodeMap.get(rootNodeId)!
    let rootNodeHasGrown = false

    // Get adjacent nodes that are electrically connected to this node
    const adjacentNodes = this.getAdjacentConnectedNodes(rootNode)

    if (adjacentNodes.length === 0) {
      this.nextBatchNodeIds.push(rootNodeId)
      return
    }

    // Try to grow in all four directions, similar to SingleLayerNodeMerger

    // Handle adjacent nodes to the LEFT
    const adjacentNodesToLeft = adjacentNodes.filter(
      (adjNode) =>
        adjNode.center.x < rootNode.center.x &&
        Math.abs(adjNode.center.y - rootNode.center.y) < rootNode.height / 2,
    )

    if (adjacentNodesToLeft.length > 0) {
      const { width: leftAdjNodeWidth, height: leftAdjNodeHeight } =
        adjacentNodesToLeft[0]
      const leftAdjNodesAreAllSameSize = adjacentNodesToLeft.every(
        (adjNode) =>
          adjNode.width === leftAdjNodeWidth &&
          adjNode.height === leftAdjNodeHeight,
      )

      const leftAdjNodesTakeUpEntireHeight =
        Math.abs(
          adjacentNodesToLeft.reduce((acc, adjNode) => {
            return acc + adjNode.height
          }, 0) - rootNode.height,
        ) < this.EPSILON

      if (leftAdjNodesTakeUpEntireHeight && leftAdjNodesAreAllSameSize) {
        rootNode.width += leftAdjNodeWidth
        rootNode.center.x = rootNode.center.x - leftAdjNodeWidth / 2

        for (const adjNode of adjacentNodesToLeft) {
          this.absorbedNodeIds.add(adjNode.capacityMeshNodeId)

          // Preserve target flag if one of them is a target
          if (adjNode._containsTarget) {
            rootNode._containsTarget = true
            rootNode._targetConnectionName =
              rootNode._targetConnectionName || adjNode._targetConnectionName
          }
        }

        rootNodeHasGrown = true
      }
    }

    // Handle adjacent nodes to the RIGHT
    const adjacentNodesToRight = adjacentNodes.filter(
      (adjNode) =>
        adjNode.center.x > rootNode.center.x &&
        Math.abs(adjNode.center.y - rootNode.center.y) < rootNode.height / 2,
    )

    if (adjacentNodesToRight.length > 0 && !rootNodeHasGrown) {
      const { width: rightAdjNodeWidth, height: rightAdjNodeHeight } =
        adjacentNodesToRight[0]
      const rightAdjNodesAreAllSameSize = adjacentNodesToRight.every(
        (adjNode) =>
          adjNode.width === rightAdjNodeWidth &&
          adjNode.height === rightAdjNodeHeight,
      )

      const rightAdjNodesTakeUpEntireHeight =
        Math.abs(
          adjacentNodesToRight.reduce((acc, adjNode) => {
            return acc + adjNode.height
          }, 0) - rootNode.height,
        ) < this.EPSILON

      if (rightAdjNodesTakeUpEntireHeight && rightAdjNodesAreAllSameSize) {
        rootNode.width += rightAdjNodeWidth
        rootNode.center.x = rootNode.center.x + rightAdjNodeWidth / 2

        for (const adjNode of adjacentNodesToRight) {
          this.absorbedNodeIds.add(adjNode.capacityMeshNodeId)

          // Preserve target flag if one of them is a target
          if (adjNode._containsTarget) {
            rootNode._containsTarget = true
            rootNode._targetConnectionName =
              rootNode._targetConnectionName || adjNode._targetConnectionName
          }
        }

        rootNodeHasGrown = true
      }
    }

    // Handle adjacent nodes to the TOP
    const adjacentNodesToTop = adjacentNodes.filter(
      (adjNode) =>
        adjNode.center.y < rootNode.center.y &&
        Math.abs(adjNode.center.x - rootNode.center.x) < rootNode.width / 2,
    )

    if (adjacentNodesToTop.length > 0 && !rootNodeHasGrown) {
      const { width: topAdjNodeWidth, height: topAdjNodeHeight } =
        adjacentNodesToTop[0]
      const topAdjNodesAreAllSameSize = adjacentNodesToTop.every(
        (adjNode) =>
          adjNode.width === topAdjNodeWidth &&
          adjNode.height === topAdjNodeHeight,
      )

      const topAdjNodesTakeUpEntireWidth =
        Math.abs(
          adjacentNodesToTop.reduce((acc, adjNode) => {
            return acc + adjNode.width
          }, 0) - rootNode.width,
        ) < this.EPSILON

      if (topAdjNodesTakeUpEntireWidth && topAdjNodesAreAllSameSize) {
        rootNode.height += topAdjNodeHeight
        rootNode.center.y = rootNode.center.y - topAdjNodeHeight / 2

        for (const adjNode of adjacentNodesToTop) {
          this.absorbedNodeIds.add(adjNode.capacityMeshNodeId)

          // Preserve target flag if one of them is a target
          if (adjNode._containsTarget) {
            rootNode._containsTarget = true
            rootNode._targetConnectionName =
              rootNode._targetConnectionName || adjNode._targetConnectionName
          }
        }

        rootNodeHasGrown = true
      }
    }

    // Handle adjacent nodes to the BOTTOM
    const adjacentNodesToBottom = adjacentNodes.filter(
      (adjNode) =>
        adjNode.center.y > rootNode.center.y &&
        Math.abs(adjNode.center.x - rootNode.center.x) < rootNode.width / 2,
    )

    if (adjacentNodesToBottom.length > 0 && !rootNodeHasGrown) {
      const { width: bottomAdjNodeWidth, height: bottomAdjNodeHeight } =
        adjacentNodesToBottom[0]
      const bottomAdjNodesAreAllSameSize = adjacentNodesToBottom.every(
        (adjNode) =>
          adjNode.width === bottomAdjNodeWidth &&
          adjNode.height === bottomAdjNodeHeight,
      )

      const bottomAdjNodesTakeUpEntireWidth =
        Math.abs(
          adjacentNodesToBottom.reduce((acc, adjNode) => {
            return acc + adjNode.width
          }, 0) - rootNode.width,
        ) < this.EPSILON

      if (bottomAdjNodesTakeUpEntireWidth && bottomAdjNodesAreAllSameSize) {
        rootNode.height += bottomAdjNodeHeight
        rootNode.center.y = rootNode.center.y + bottomAdjNodeHeight / 2

        for (const adjNode of adjacentNodesToBottom) {
          this.absorbedNodeIds.add(adjNode.capacityMeshNodeId)

          // Preserve target flag if one of them is a target
          if (adjNode._containsTarget) {
            rootNode._containsTarget = true
            rootNode._targetConnectionName =
              rootNode._targetConnectionName || adjNode._targetConnectionName
          }
        }

        rootNodeHasGrown = true
      }
    }

    if (rootNodeHasGrown) {
      this.batchHadModifications = true
      this.currentBatchNodeIds.push(rootNodeId)
    } else {
      // Try a secondary approach for obstacles
      if (rootNode._containsTarget) {
        // For target nodes, attempt to merge with overlapping obstacles
        if (this.mergeWithOverlappingObstacles(rootNode)) {
          this.batchHadModifications = true
          this.currentBatchNodeIds.push(rootNodeId)
        } else {
          this.nextBatchNodeIds.unshift(rootNodeId)
        }
      } else {
        this.nextBatchNodeIds.unshift(rootNodeId)
      }
    }
  }

  /**
   * Try to merge a node with obstacles it overlaps with
   */
  mergeWithOverlappingObstacles(node: CapacityMeshNode): boolean {
    if (!node._targetConnectionName) return false

    const relevantObstacles = this.obstacles.filter((obstacle) => {
      // If obstacle has explicit connections, check if it's connected to this node
      if (obstacle.connectedTo && obstacle.connectedTo.length > 0) {
        return obstacle.connectedTo.some((connId) =>
          this.connMap.areIdsConnected(node._targetConnectionName!, connId),
        )
      }

      // Otherwise check for overlap with node
      return (
        doRectsOverlap(node, obstacle) &&
        obstacle.zLayers?.some((z) => node.availableZ.includes(z))
      )
    })

    if (relevantObstacles.length === 0) return false

    // Compute new bounds that include all relevant obstacles
    const bounds = {
      minX: node.center.x - node.width / 2,
      minY: node.center.y - node.height / 2,
      maxX: node.center.x + node.width / 2,
      maxY: node.center.y + node.height / 2,
    }

    for (const obstacle of relevantObstacles) {
      bounds.minX = Math.min(
        bounds.minX,
        obstacle.center.x - obstacle.width / 2,
      )
      bounds.minY = Math.min(
        bounds.minY,
        obstacle.center.y - obstacle.height / 2,
      )
      bounds.maxX = Math.max(
        bounds.maxX,
        obstacle.center.x + obstacle.width / 2,
      )
      bounds.maxY = Math.max(
        bounds.maxY,
        obstacle.center.y + obstacle.height / 2,
      )
    }

    // Apply new bounds to node
    node.width = bounds.maxX - bounds.minX
    node.height = bounds.maxY - bounds.minY
    node.center.x = (bounds.minX + bounds.maxX) / 2
    node.center.y = (bounds.minY + bounds.maxY) / 2

    // Mark additional properties
    node._containsObstacle = true
    node._completelyInsideObstacle = false

    return true
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      rects: [],
      lines: [],
      points: [],
      circles: [],
    }

    // Visualize obstacles
    for (const obstacle of this.obstacles) {
      graphics.rects!.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(255, 0, 0, 0.2)",
        stroke: "rgba(255, 0, 0, 0.8)",
        label: `Obstacle${obstacle.connectedTo ? `\nConnected to: ${obstacle.connectedTo.join(", ")}` : ""}`,
      })
    }

    // Visualize targets from connectivity map
    for (const { name, pointsToConnect } of this.connections ?? []) {
      for (const target of pointsToConnect) {
        graphics.points!.push({
          x: target.x,
          y: target.y,
          color: this.colorMap?.[name] || "rgba(255, 0, 255, 0.8)",
          label: `Target: ${name}\n(${target.x.toFixed(2)}, ${target.y.toFixed(2)})`,
        })
      }
    }

    // Visualize all nodes
    for (const node of this.newNodes) {
      graphics.rects!.push({
        ...createRectFromCapacityNode(node),
        stroke: "rgba(0, 255, 0, 0.8)",
        label: `${node.capacityMeshNodeId}\n${node.width.toFixed(2)}x${node.height.toFixed(2)}\n${node._targetConnectionName || ""}`,
      })
    }

    // Visualize any nodes in current batch
    for (const nodeId of this.currentBatchNodeIds) {
      if (this.absorbedNodeIds.has(nodeId)) continue
      const node = this.nodeMap.get(nodeId)!
      graphics.rects!.push({
        ...createRectFromCapacityNode(node),
        stroke: "rgba(255, 165, 0, 0.8)",
        label: `${node.capacityMeshNodeId}\n${node.width.toFixed(2)}x${node.height.toFixed(2)}\nCurrent Batch\n${node._targetConnectionName || ""}`,
      })
    }

    // Visualize nodes in next batch
    for (const nodeId of this.nextBatchNodeIds) {
      if (this.absorbedNodeIds.has(nodeId)) continue
      const node = this.nodeMap.get(nodeId)!
      graphics.rects!.push({
        ...createRectFromCapacityNode(node),
        stroke: "rgba(0, 0, 255, 0.8)",
        label: `${node.capacityMeshNodeId}\n${node.width.toFixed(2)}x${node.height.toFixed(2)}\nNext Batch\n${node._targetConnectionName || ""}`,
      })
    }

    return graphics
  }
}

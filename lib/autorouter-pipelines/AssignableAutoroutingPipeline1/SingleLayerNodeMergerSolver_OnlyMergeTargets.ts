import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { GraphicsObject } from "graphics-debug"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"

const EPSILON = 0.005

/**
 * Variant of SingleLayerNodeMergerSolver that only merges nodes containing targets.
 * Nodes without targets are passed through unchanged.
 */
export class SingleLayerNodeMergerSolver_OnlyMergeTargets extends BaseSolver {
  override getSolverName(): string {
    return "SingleLayerNodeMergerSolver_OnlyMergeTargets"
  }

  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  currentBatchNodeIds: CapacityMeshNodeId[]

  absorbedNodeIds: Set<CapacityMeshNodeId>

  nextBatchNodeIds: CapacityMeshNodeId[]
  batchHadModifications: boolean

  hasComputedAdjacentNodeIds: boolean = false

  newNodes: CapacityMeshNode[]
  constructor(nodes: CapacityMeshNode[]) {
    super()
    this.nodeMap = new Map()
    this.MAX_ITERATIONS = 100_000
    for (const node of nodes) {
      this.nodeMap.set(node.capacityMeshNodeId, node)
    }
    this.newNodes = []
    this.absorbedNodeIds = new Set()
    const unprocessedNodesWithArea: Array<[CapacityMeshNode, number]> = []
    for (const node of nodes) {
      // Skip assignable via nodes - pass them through unchanged
      if ((node as any)._assignedViaObstacle) {
        this.newNodes.push(node)
        this.absorbedNodeIds.add(node.capacityMeshNodeId)
        continue
      }

      // Only process nodes that contain targets
      if (!node._containsTarget) {
        this.newNodes.push(node)
        this.absorbedNodeIds.add(node.capacityMeshNodeId)
      } else if (node.availableZ.length > 1) {
        this.newNodes.push(node)
        this.absorbedNodeIds.add(node.capacityMeshNodeId)
      } else {
        unprocessedNodesWithArea.push([node, node.width * node.height])
      }
    }
    unprocessedNodesWithArea.sort((a, b) => a[1] - b[1])
    for (const [node, area] of unprocessedNodesWithArea) {
      const unprocessedNode = {
        ...node,
        center: { ...node.center },
      }
      this.nodeMap.set(node.capacityMeshNodeId, unprocessedNode)
    }
    this.currentBatchNodeIds = unprocessedNodesWithArea.map(
      ([node]) => node.capacityMeshNodeId,
    )
    this.nextBatchNodeIds = []
    this.batchHadModifications = false
  }

  computeAdjacentNodeIdsForFirstBatch(nodes: CapacityMeshNode[]) {
    // Determine max layer from all nodes
    const maxLayer = Math.max(...nodes.map((n) => Math.max(...n.availableZ)))
    const nodeTrees: CapacityNodeTree[] = []
    for (let i = 0; i <= maxLayer; i++) {
      nodeTrees.push(
        new CapacityNodeTree(nodes.filter((n) => n.availableZ[0] === i)),
      )
    }
    for (const node of nodes) {
      const adjacentNodes: CapacityMeshNode[] = []
      const z = node.availableZ[0]

      const nodesInArea = nodeTrees[z].getNodesInArea(
        node.center.x,
        node.center.y,
        node.width * 4,
        node.height * 4,
      )

      for (const unprocessedNode of nodesInArea) {
        // Only merge targets with the exact same target name
        if (
          (unprocessedNode._containsTarget &&
            unprocessedNode._targetConnectionName !==
              node._targetConnectionName) ||
          (node._containsTarget &&
            (!unprocessedNode._containsTarget ||
              unprocessedNode._targetConnectionName !==
                node._targetConnectionName))
        ) {
          continue
        }
        if (unprocessedNode.capacityMeshNodeId === node.capacityMeshNodeId)
          continue
        if (!areNodesBordering(node, unprocessedNode)) continue

        adjacentNodes.push(unprocessedNode)
      }

      node._adjacentNodeIds = adjacentNodes.map((n) => n.capacityMeshNodeId)
    }
  }

  getAdjacentSameLayerUnprocessedNodes(rootNode: CapacityMeshNode) {
    const adjacentNodes: CapacityMeshNode[] = []
    const unprocessedAdjNodes: CapacityMeshNode[] = Array.from(
      new Set(
        (rootNode._adjacentNodeIds ?? []).map((a) => this.nodeMap.get(a)!),
      ),
    ).filter((n) => n && n.capacityMeshNodeId !== rootNode.capacityMeshNodeId)

    unprocessedAdjNodes.sort((a, b) => a.width * a.height - b.width * b.height)

    for (const unprocessedNode of unprocessedAdjNodes) {
      if (this.absorbedNodeIds.has(unprocessedNode.capacityMeshNodeId)) continue
      adjacentNodes.push(unprocessedNode)
    }

    return adjacentNodes
  }

  _step() {
    if (!this.hasComputedAdjacentNodeIds) {
      this.computeAdjacentNodeIdsForFirstBatch(
        this.currentBatchNodeIds.map((id) => this.nodeMap.get(id)!),
      )
      this.hasComputedAdjacentNodeIds = true
    }
    let rootNodeId = this.currentBatchNodeIds.pop()
    while (rootNodeId && this.absorbedNodeIds.has(rootNodeId)) {
      rootNodeId = this.currentBatchNodeIds.pop()
    }

    if (!rootNodeId) {
      if (this.batchHadModifications) {
        this.currentBatchNodeIds = this.nextBatchNodeIds.sort((a, b) => {
          const A = this.nodeMap.get(a)!
          const B = this.nodeMap.get(b)!
          return A.width * A.height - B.width * B.height
        })
        this.nextBatchNodeIds = []
        this.batchHadModifications = false
        return
      }

      this.solved = true
      this.newNodes.push(
        ...this.nextBatchNodeIds.map((id) => this.nodeMap.get(id)!),
      )
      return
    }

    const rootNode = this.nodeMap.get(rootNodeId)!
    let rootNodeHasGrown = false

    const adjacentNodes = this.getAdjacentSameLayerUnprocessedNodes(rootNode)

    if (adjacentNodes.length === 0) {
      this.nextBatchNodeIds.push(rootNodeId)
      return
    }

    const absorbAdjacentNodeIds = (nodesToAbsorb: CapacityMeshNode[]) => {
      for (const adjNode of nodesToAbsorb) {
        this.absorbedNodeIds.add(adjNode.capacityMeshNodeId)
      }

      rootNode._adjacentNodeIds = Array.from(
        new Set(
          [
            ...(rootNode._adjacentNodeIds ?? []),
            ...nodesToAbsorb.flatMap((n) => n._adjacentNodeIds ?? []),
          ].filter(
            (id) =>
              id !== rootNode.capacityMeshNodeId &&
              !this.absorbedNodeIds.has(id),
          ),
        ),
      )
    }

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
        ) < EPSILON

      if (leftAdjNodesTakeUpEntireHeight && leftAdjNodesAreAllSameSize) {
        rootNode.width += leftAdjNodeWidth
        rootNode.center.x = rootNode.center.x - leftAdjNodeWidth / 2

        absorbAdjacentNodeIds(adjacentNodesToLeft)

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
        ) < EPSILON

      if (rightAdjNodesTakeUpEntireHeight && rightAdjNodesAreAllSameSize) {
        rootNode.width += rightAdjNodeWidth
        rootNode.center.x = rootNode.center.x + rightAdjNodeWidth / 2

        absorbAdjacentNodeIds(adjacentNodesToRight)

        rootNodeHasGrown = true
      }
    }

    // Handle adjacent nodes to the TOP
    const adjacentNodesToTop = adjacentNodes.filter(
      (adjNode) =>
        adjNode.center.y > rootNode.center.y &&
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
        ) < EPSILON

      if (topAdjNodesTakeUpEntireWidth && topAdjNodesAreAllSameSize) {
        rootNode.height += topAdjNodeHeight
        rootNode.center.y = rootNode.center.y + topAdjNodeHeight / 2

        absorbAdjacentNodeIds(adjacentNodesToTop)

        rootNodeHasGrown = true
      }
    }

    // Handle adjacent nodes to the BOTTOM
    const adjacentNodesToBottom = adjacentNodes.filter(
      (adjNode) =>
        adjNode.center.y < rootNode.center.y &&
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
        ) < EPSILON

      if (bottomAdjNodesTakeUpEntireWidth && bottomAdjNodesAreAllSameSize) {
        rootNode.height += bottomAdjNodeHeight
        rootNode.center.y = rootNode.center.y - bottomAdjNodeHeight / 2

        absorbAdjacentNodeIds(adjacentNodesToBottom)

        rootNodeHasGrown = true
      }
    }

    if (rootNodeHasGrown) {
      this.batchHadModifications = true
      this.currentBatchNodeIds.push(rootNodeId)
    } else {
      this.nextBatchNodeIds.unshift(rootNodeId)
    }
  }

  visualize(): GraphicsObject {
    const graphics = {
      circles: [],
      lines: [],
      points: [],
      rects: [],
      coordinateSystem: "cartesian",
      title: "Single Layer Node Merger (Only Merge Targets)",
    } as GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles">

    for (const node of this.newNodes) {
      graphics.rects.push(createRectFromCapacityNode(node))
    }

    const nextNodeIdInBatch =
      this.currentBatchNodeIds[this.currentBatchNodeIds.length - 1]
    let adjacentNodes: CapacityMeshNode[] | undefined
    if (nextNodeIdInBatch) {
      adjacentNodes = this.getAdjacentSameLayerUnprocessedNodes(
        this.nodeMap.get(nextNodeIdInBatch)!,
      )
    }

    // Visualize unprocessed nodes with a different style
    for (const nodeId of this.currentBatchNodeIds) {
      const node = this.nodeMap.get(nodeId)
      if (this.absorbedNodeIds.has(nodeId)) continue
      if (node) {
        const rect = createRectFromCapacityNode(node, {
          rectMargin: 0.01,
        })
        if (nodeId === nextNodeIdInBatch) {
          rect.stroke = "rgba(0, 255, 0, 0.8)" // Green for next node in batch
        } else if (
          adjacentNodes?.some(
            (adjNode) => adjNode.capacityMeshNodeId === nodeId,
          )
        ) {
          rect.stroke = "rgba(128, 0, 128, 0.8)" // Purple for adjacent nodes
        } else {
          rect.stroke = "rgba(255, 165, 0, 0.8)" // Orange border for other nodes
        }
        rect.layer = `z${node.availableZ.join(",")}`
        rect.label = `${rect.label}\n(unprocessed)`
        graphics.rects.push(rect)
      }
    }

    // Visualize next batch nodes with a different style
    for (const nodeId of this.nextBatchNodeIds) {
      const node = this.nodeMap.get(nodeId)
      if (this.absorbedNodeIds.has(nodeId)) continue
      if (node) {
        const rect = createRectFromCapacityNode(node, {
          rectMargin: 0.01,
        })
        rect.layer = `z${node.availableZ.join(",")}`
        rect.stroke = "rgba(0, 217, 255, 0.8)" // Green border
        rect.label = `${rect.label}\nx: ${node.center.x}, y: ${node.center.y}\n${node.width}x${node.height}\n(next batch)`
        graphics.rects.push(rect)
      }
    }

    return graphics
  }
}

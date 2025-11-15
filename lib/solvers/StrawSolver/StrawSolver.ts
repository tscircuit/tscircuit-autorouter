import { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"

export class StrawSolver extends BaseSolver {
  multiLayerNodes: CapacityMeshNode[]

  strawNodes: CapacityMeshNode[]
  skippedNodes: CapacityMeshNode[]

  unprocessedNodes: CapacityMeshNode[]
  strawSize: number

  nodeIdCounter: number

  constructor(params: {
    nodes: CapacityMeshNode[]
    strawSize?: number
  }) {
    super()
    this.MAX_ITERATIONS = 100e3
    this.strawSize = params.strawSize ?? 0.5
    this.multiLayerNodes = []
    this.strawNodes = []
    this.skippedNodes = []
    this.nodeIdCounter = 0
    this.unprocessedNodes = []
    for (const node of params.nodes) {
      if (node.availableZ.length === 1) {
        this.unprocessedNodes.push(node)
      } else {
        this.multiLayerNodes.push(node)
      }
    }
  }

  getCapacityOfMultiLayerNodesWithinBounds(bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }): number {
    let totalCapacity = 0

    for (const node of this.multiLayerNodes) {
      // Calculate node bounds
      const nodeMinX = node.center.x - node.width / 2
      const nodeMaxX = node.center.x + node.width / 2
      const nodeMinY = node.center.y - node.height / 2
      const nodeMaxY = node.center.y + node.height / 2

      // Calculate overlap area
      const overlapMinX = Math.max(bounds.minX, nodeMinX)
      const overlapMaxX = Math.min(bounds.maxX, nodeMaxX)
      const overlapMinY = Math.max(bounds.minY, nodeMinY)
      const overlapMaxY = Math.min(bounds.maxY, nodeMaxY)

      // If there's an overlap
      if (overlapMinX < overlapMaxX && overlapMinY < overlapMaxY) {
        const overlapWidth = overlapMaxX - overlapMinX
        const overlapHeight = overlapMaxY - overlapMinY
        const overlapArea = overlapWidth * overlapHeight
        const nodeArea = node.width * node.height

        // Calculate proportion of node that overlaps
        const proportion = overlapArea / nodeArea

        // Add proportional capacity to total
        totalCapacity += getTunedTotalCapacity1(node) * proportion
      }
    }

    return totalCapacity
  }

  getSurroundingCapacities(node: CapacityMeshNode): {
    leftSurroundingCapacity: number
    rightSurroundingCapacity: number
    topSurroundingCapacity: number
    bottomSurroundingCapacity: number
  } {
    const searchDistance = Math.min(node.width, node.height)

    const leftSurroundingCapacity =
      this.getCapacityOfMultiLayerNodesWithinBounds({
        minX: node.center.x - node.width / 2 - searchDistance,
        maxX: node.center.x - node.width / 2,
        minY: node.center.y - node.height / 2,
        maxY: node.center.y + node.height / 2,
      })

    const rightSurroundingCapacity =
      this.getCapacityOfMultiLayerNodesWithinBounds({
        minX: node.center.x + node.width / 2,
        maxX: node.center.x + node.width / 2 + searchDistance,
        minY: node.center.y - node.height / 2,
        maxY: node.center.y + node.height / 2,
      })

    const topSurroundingCapacity =
      this.getCapacityOfMultiLayerNodesWithinBounds({
        minX: node.center.x - node.width / 2,
        maxX: node.center.x + node.width / 2,
        minY: node.center.y - node.height / 2 - searchDistance,
        maxY: node.center.y - node.height / 2,
      })

    const bottomSurroundingCapacity =
      this.getCapacityOfMultiLayerNodesWithinBounds({
        minX: node.center.x - node.width / 2,
        maxX: node.center.x + node.width / 2,
        minY: node.center.y + node.height / 2,
        maxY: node.center.y + node.height / 2 + searchDistance,
      })

    return {
      leftSurroundingCapacity,
      rightSurroundingCapacity,
      topSurroundingCapacity,
      bottomSurroundingCapacity,
    }
  }
  /**
   * Creates straw nodes from a single-layer node based on surrounding capacities
   */
  createStrawsForNode(node: CapacityMeshNode): CapacityMeshNode[] {
    const result: CapacityMeshNode[] = []
    const {
      leftSurroundingCapacity,
      rightSurroundingCapacity,
      topSurroundingCapacity,
      bottomSurroundingCapacity,
    } = this.getSurroundingCapacities(node)

    // Decide whether to create horizontal or vertical straws
    const horizontalCapacity =
      leftSurroundingCapacity + rightSurroundingCapacity
    const verticalCapacity = topSurroundingCapacity + bottomSurroundingCapacity

    // Layer-specific preferred direction
    // Layer 0 (top) prefers horizontal traces, Layer 1 (bottom) prefers vertical
    const layerPrefersFactor = 1 // node.availableZ[0] === 0 ? 1.3 : 0.7

    const effectiveHorizontalCapacity = horizontalCapacity * layerPrefersFactor

    // Create straws based on dimensions and surrounding capacity
    if (effectiveHorizontalCapacity > verticalCapacity) {
      // Create horizontal straws
      const numStraws = Math.floor(node.height / this.strawSize)
      const strawHeight = node.height / numStraws

      for (let i = 0; i < numStraws; i++) {
        const strawCenterY =
          node.center.y - node.height / 2 + i * strawHeight + strawHeight / 2

        result.push({
          capacityMeshNodeId: `${node.capacityMeshNodeId}_straw${i}`,
          center: { x: node.center.x, y: strawCenterY },
          width: node.width,
          height: strawHeight,
          layer: node.layer,
          availableZ: [...node.availableZ],
          _depth: node._depth,
          _strawNode: true,
          _strawParentCapacityMeshNodeId: node.capacityMeshNodeId,
        })
      }
    } else {
      // Create vertical straws
      const numStraws = Math.floor(node.width / this.strawSize)
      const strawWidth = node.width / numStraws

      for (let i = 0; i < numStraws; i++) {
        const strawCenterX =
          node.center.x - node.width / 2 + i * strawWidth + strawWidth / 2

        result.push({
          capacityMeshNodeId: `${node.capacityMeshNodeId}_straw${i}`,
          center: { x: strawCenterX, y: node.center.y },
          width: strawWidth,
          height: node.height,
          layer: node.layer,
          availableZ: [...node.availableZ],
          _depth: node._depth,
          _strawNode: true,
          _strawParentCapacityMeshNodeId: node.capacityMeshNodeId,
        })
      }
    }

    return result
  }

  getResultNodes(): CapacityMeshNode[] {
    return [...this.multiLayerNodes, ...this.strawNodes, ...this.skippedNodes]
  }

  _step() {
    const rootNode = this.unprocessedNodes.pop()

    if (!rootNode) {
      this.solved = true
      return
    }

    // Mark nodes that are too small to subdivide as ignorable (don't delete them)
    if (rootNode.width < this.strawSize && rootNode.height < this.strawSize) {
      rootNode._isIgnorable = true
      this.strawNodes.push(rootNode) // Keep the node, just mark it
      return
    }

    // Skip target nodes (keep them intact)
    if (rootNode._containsTarget) {
      this.skippedNodes.push(rootNode)
      return
    }

    // Create straws for this node
    const strawNodes = this.createStrawsForNode(rootNode)
    if (strawNodes.length === 0) {
      rootNode._isIgnorable = true
      this.skippedNodes.push(rootNode)
    } else {
      this.strawNodes.push(...strawNodes)
    }
  }

  visualize(): GraphicsObject {
    const ignorableCount = this.strawNodes.filter(
      (node) => node._isIgnorable,
    ).length
    const totalStrawCount = this.strawNodes.length

    const graphics: GraphicsObject = {
      rects: [],
      lines: [],
      points: [],
      circles: [],
      title: `Straw Solver${ignorableCount > 0 ? ` - ${ignorableCount} Ignorable Nodes` : ""}`,
    }

    // Add summary statistics if there are ignorable nodes
    if (ignorableCount > 0) {
      graphics.points!.push({
        x: 0,
        y: 0,
        label: `Ignorable Nodes: ${ignorableCount}/${totalStrawCount} (${((ignorableCount / totalStrawCount) * 100).toFixed(1)}%)`,
        color: "rgba(255, 200, 0, 1)",
        layer: "info",
      })
    }

    // Draw unprocessed nodes with special highlighting for targets
    for (const node of this.unprocessedNodes) {
      let fillColor = "rgba(200, 200, 200, 0.5)"
      let strokeColor = "rgba(0, 0, 0, 0.5)"
      let label = `${node.capacityMeshNodeId}\nUnprocessed\n${node.width}x${node.height}`

      if (node._containsTarget) {
        fillColor = "rgba(100, 255, 100, 0.6)" // Green for targets
        strokeColor = "rgba(0, 200, 0, 0.8)"
        label = `${node.capacityMeshNodeId}\nTARGET\n${node.width}x${node.height}`
      }

      graphics.rects!.push({
        center: node.center,
        width: node.width,
        height: node.height,
        fill: fillColor,
        stroke: strokeColor,
        label: label,
      })
    }

    // Draw straw nodes with different colors based on layer and ignorable status
    for (const node of this.strawNodes) {
      let color: string
      let strokeColor: string
      let strokeWidthNum: number

      if (node._isIgnorable) {
        // Highlight ignorable nodes with special styling
        color =
          node.availableZ[0] === 0
            ? "rgba(255, 200, 0, 0.6)" // Yellow for layer 0 ignorable
            : "rgba(255, 150, 50, 0.6)" // Orange for other layers
        strokeColor = "rgba(255, 100, 0, 0.8)"
        strokeWidthNum = 2 // Thicker border for ignorable nodes
      } else {
        // Normal styling for non-ignorable nodes
        color =
          node.availableZ[0] === 0
            ? "rgba(0, 150, 255, 0.5)"
            : "rgba(255, 100, 0, 0.5)"
        strokeColor = "rgba(0, 0, 0, 0.5)"
        strokeWidthNum = 1
      }

      graphics.rects!.push({
        center: node.center,
        width: node.width,
        height: node.height,
        fill: color,
        stroke: strokeColor,
        label: `${node.capacityMeshNodeId}\nLayer: ${node.availableZ[0]}${node._isIgnorable ? "\nIGNORABLE" : ""}\n${node.width}x${node.height}`,
        layer: `z${node.availableZ.join(",")}`,
      })

      // Add a small indicator circle for ignorable nodes
      if (node._isIgnorable) {
        graphics.circles!.push({
          center: {
            x: node.center.x + node.width / 2 - 0.1,
            y: node.center.y + node.height / 2 - 0.1,
          },
          radius: 0.05,
          fill: "rgba(255, 0, 0, 1)",
          layer: `z${node.availableZ.join(",")}`,
          label: "!",
        })
      }
    }

    // Draw multi-layer nodes with special highlighting for targets
    for (const node of this.multiLayerNodes) {
      let fillColor = "rgba(100, 255, 100, 0.5)"
      let strokeColor = "rgba(0, 0, 0, 0.5)"
      let label = `${node.capacityMeshNodeId}\nLayers: ${node.availableZ.join(",")}\n${node.width}x${node.height}`

      if (node._containsTarget) {
        fillColor = "rgba(50, 255, 50, 0.7)" // Brighter green for targets
        strokeColor = "rgba(0, 150, 0, 0.8)"
        label = `${node.capacityMeshNodeId}\nTARGET\nLayers: ${node.availableZ.join(",")}\n${node.width}x${node.height}`
      }

      graphics.rects!.push({
        center: node.center,
        width: node.width * 0.9,
        height: node.height * 0.9,
        fill: fillColor,
        stroke: strokeColor,
        layer: `z${node.availableZ.join(",")}`,
        label: label,
      })
    }

    return graphics
  }
}

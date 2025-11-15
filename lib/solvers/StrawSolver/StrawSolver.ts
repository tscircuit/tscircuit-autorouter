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

    // Skip nodes that are too small to subdivide
    if (rootNode.width < this.strawSize && rootNode.height < this.strawSize) {
      this.skippedNodes.push(rootNode)
      return
    }

    // Skip target nodes (keep them intact)
    if (rootNode._containsTarget) {
      this.skippedNodes.push(rootNode)
      return
    }

    // Create straws for this node
    const strawNodes = this.createStrawsForNode(rootNode)
    this.strawNodes.push(...strawNodes)
    if (strawNodes.length === 0) this.strawNodes.push(rootNode) // Keep the original node as well
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      rects: [],
      lines: [],
      points: [],
      circles: [],
      title: "Straw Solver",
    }

    // Draw unprocessed nodes
    for (const node of this.unprocessedNodes) {
      graphics.rects!.push({
        center: node.center,
        width: node.width,
        height: node.height,
        fill: "rgba(200, 200, 200, 0.5)",
        stroke: "rgba(0, 0, 0, 0.5)",
        label: `${node.capacityMeshNodeId}\nUnprocessed\n${node.width}x${node.height}`,
      })
    }

    // Draw straw nodes with different colors based on layer
    for (const node of this.strawNodes) {
      const color =
        node.availableZ[0] === 0
          ? "rgba(0, 150, 255, 0.5)"
          : "rgba(255, 100, 0, 0.5)"

      graphics.rects!.push({
        center: node.center,
        width: node.width,
        height: node.height,
        fill: color,
        stroke: "rgba(0, 0, 0, 0.5)",
        label: `${node.capacityMeshNodeId}\nLayer: ${node.availableZ[0]}\n${node.width}x${node.height}`,
        layer: `z${node.availableZ.join(",")}`,
      })
    }

    // Draw multi-layer nodes
    for (const node of this.multiLayerNodes) {
      graphics.rects!.push({
        center: node.center,
        width: node.width * 0.9,
        height: node.height * 0.9,
        fill: "rgba(100, 255, 100, 0.5)",
        stroke: "rgba(0, 0, 0, 0.5)",
        layer: `z${node.availableZ.join(",")}`,
        label: `${node.capacityMeshNodeId}\nLayers: ${node.availableZ.join(",")}\n${node.width}x${node.height}`,
      })
    }

    return graphics
  }
}

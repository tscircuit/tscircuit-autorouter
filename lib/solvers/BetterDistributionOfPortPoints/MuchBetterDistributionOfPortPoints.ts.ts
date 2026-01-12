import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"

interface MuchBetterDistributionOfPortPointsInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
  minTraceWidth: number
  layerCount: number
}

type Sides = {
  left: number
  right: number
  top: number
  bottom: number
}

type Side = "left" | "right" | "top" | "bottom"

type NodeBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type PortPointWithSide = PortPoint & {
  side: Side
  ownerNodeId: string
}

export class MuchBetterDistributionOfPortPointsSolver extends BaseSolver {
  mapOfNodeIdToLengthOfEachSide: Map<string, Sides>
  nodeAndSideKeyQueue: string[]
  mapOfNodeIdToBounds: Map<string, NodeBounds>
  mapOfNodeAndSideToPortPoints: Map<string, PortPointWithSide[]>
  currentNodeAndSideKey: string | null = null
  redistributedNodes: NodeWithPortPoints[]

  constructor(private input: MuchBetterDistributionOfPortPointsInput) {
    super()
    this.mapOfNodeIdToLengthOfEachSide = new Map()
    this.mapOfNodeIdToBounds = new Map()
    this.mapOfNodeAndSideToPortPoints = new Map()
    this.redistributedNodes = []
    this.nodeAndSideKeyQueue = []

    // Assert input validity - check that inputNodWithPortPoints have valid structure
    for (const inputNode of input.inputNodWithPortPoints) {
      console.assert(
        inputNode.capacityMeshNodeId,
        "Input node must have capacityMeshNodeId",
      )
      console.assert(
        Number.isFinite(inputNode.center?.x) &&
          Number.isFinite(inputNode.center?.y),
        `Input node ${inputNode.capacityMeshNodeId} must have valid center coordinates`,
      )
      console.assert(
        Number.isFinite(inputNode.width) && Number.isFinite(inputNode.height),
        `Input node ${inputNode.capacityMeshNodeId} must have valid width and height`,
      )

      for (const portPoint of inputNode.portPoints) {
        // Skip port points without portPointId
        if (!portPoint.portPointId) continue

        console.assert(
          portPoint.connectionNodeIds &&
            portPoint.connectionNodeIds.length === 2,
          `Port point ${portPoint.portPointId} in node ${inputNode.capacityMeshNodeId} must have exactly 2 connectionNodeIds`,
        )
        console.assert(
          Number.isFinite(portPoint.x) &&
            Number.isFinite(portPoint.y) &&
            Number.isFinite(portPoint.z),
          `Port point ${portPoint.portPointId} must have valid x, y, z coordinates`,
        )
      }
    }

    // Calculate length of each side and bounds for each node
    for (const node of input.nodeWithPortPoints) {
      console.assert(
        node.capacityMeshNodeId,
        "Node must have capacityMeshNodeId",
      )
      console.assert(
        Number.isFinite(node.width) && Number.isFinite(node.height),
        `Node ${node.capacityMeshNodeId} must have valid width and height: width=${node.width}, height=${node.height}`,
      )
      console.assert(
        Number.isFinite(node.center?.x) && Number.isFinite(node.center?.y),
        `Node ${node.capacityMeshNodeId} must have valid center: ${JSON.stringify(node.center)}`,
      )

      const width = node.width
      const height = node.height

      this.mapOfNodeIdToLengthOfEachSide.set(node.capacityMeshNodeId, {
        left: height,
        right: height,
        top: width,
        bottom: width,
      })

      const bounds = {
        minX: node.center.x - width / 2,
        maxX: node.center.x + width / 2,
        minY: node.center.y - height / 2,
        maxY: node.center.y + height / 2,
      }

      console.assert(
        Number.isFinite(bounds.minX) &&
          Number.isFinite(bounds.maxX) &&
          Number.isFinite(bounds.minY) &&
          Number.isFinite(bounds.maxY),
        `Calculated bounds for node ${node.capacityMeshNodeId} must be finite`,
      )

      this.mapOfNodeIdToBounds.set(node.capacityMeshNodeId, bounds)
    }

    // Group port points by owner node and side
    for (const node of input.nodeWithPortPoints) {
      const bounds = this.mapOfNodeIdToBounds.get(node.capacityMeshNodeId)
      console.assert(bounds, `Bounds must exist for node ${node.capacityMeshNodeId}`)
      if (!bounds) continue

      for (const portPoint of node.portPoints) {
        // Skip port points without portPointId
        if (!portPoint.portPointId) continue

        // Verify port point coordinates are valid
        console.assert(
          Number.isFinite(portPoint.x) &&
            Number.isFinite(portPoint.y) &&
            Number.isFinite(portPoint.z),
          `Port point ${portPoint.portPointId} must have valid coordinates`,
        )

        const side = this.classifyPortPointSide(portPoint, bounds)
        if (!side) continue // Ignore diagonal/unclassifiable points

        // Determine which node owns this port point based on side length
        const ownerNodeId = this.determineOwnerNode(
          portPoint,
          node.capacityMeshNodeId,
        )

        const portWithSide: PortPointWithSide = {
          ...portPoint,
          side,
          ownerNodeId,
        }

        const key = `${ownerNodeId}:${side}`
        const existing = this.mapOfNodeAndSideToPortPoints.get(key) ?? []
        existing.push(portWithSide)
        this.mapOfNodeAndSideToPortPoints.set(key, existing)
      }
    }

    // Build queue of node-side combinations that have port points
    this.nodeAndSideKeyQueue = Array.from(this.mapOfNodeAndSideToPortPoints.keys())
  }

  /**
   * Classify which side a port point is on (top, right, bottom, left)
   * Returns null if the point is on a diagonal or can't be classified
   */
  classifyPortPointSide(
    portPoint: PortPoint,
    bounds: NodeBounds,
  ): Side | null {
    const tolerance = 0.001 // Small tolerance for floating point comparison

    const isOnTop = Math.abs(portPoint.y - bounds.maxY) < tolerance
    const isOnBottom = Math.abs(portPoint.y - bounds.minY) < tolerance
    const isOnLeft = Math.abs(portPoint.x - bounds.minX) < tolerance
    const isOnRight = Math.abs(portPoint.x - bounds.maxX) < tolerance

    // Check if on a single side (not diagonal)
    const sideCount = [isOnTop, isOnBottom, isOnLeft, isOnRight].filter(
      Boolean,
    ).length

    if (sideCount !== 1) {
      return null // Diagonal or not on edge
    }

    if (isOnTop) return "top"
    if (isOnBottom) return "bottom"
    if (isOnLeft) return "left"
    if (isOnRight) return "right"

    return null
  }

  /**
   * Check if a port point should be ignored because it's in a target node
   * or connects to a target node.
   */
  shouldIgnorePortPoint(portPoint: PortPoint, currentNodeId: string): boolean {
    // Check if the current node is a target node
    const currentInputNode = this.input.inputNodWithPortPoints.find(
      (n) => n.capacityMeshNodeId === currentNodeId,
    )
    if (currentInputNode?._containsTarget) {
      return true
    }

    // Find the input port point to get connectionNodeIds
    const inputPortPoint = currentInputNode?.portPoints.find(
      (p) => p.portPointId === portPoint.portPointId,
    )
    if (
      !inputPortPoint?.connectionNodeIds ||
      inputPortPoint.connectionNodeIds.length !== 2
    ) {
      return false
    }

    // Check if any of the connected nodes is a target node
    for (const connectedNodeId of inputPortPoint.connectionNodeIds) {
      const connectedInputNode = this.input.inputNodWithPortPoints.find(
        (n) => n.capacityMeshNodeId === connectedNodeId,
      )
      if (connectedInputNode?._containsTarget) {
        return true
      }
    }

    return false
  }

  /**
   * Determine which node owns this port point based on the side length strategy.
   * We select the node whose side (that the port is on) has the smaller length.
   */
  determineOwnerNode(
    portPoint: PortPoint,
    currentNodeId: string,
  ): string {
    // Find the input port point to get connectionNodeIds
    const inputNode = this.input.inputNodWithPortPoints.find(
      (n) => n.capacityMeshNodeId === currentNodeId,
    )
    if (!inputNode) return currentNodeId

    const inputPortPoint = inputNode.portPoints.find(
      (p) => p.portPointId === portPoint.portPointId,
    )
    if (
      !inputPortPoint?.connectionNodeIds ||
      inputPortPoint.connectionNodeIds.length !== 2
    ) {
      return currentNodeId
    }

    const [nodeId1, nodeId2] = inputPortPoint.connectionNodeIds

    // Get bounds for both nodes
    const bounds1 = this.mapOfNodeIdToBounds.get(nodeId1)
    const bounds2 = this.mapOfNodeIdToBounds.get(nodeId2)

    if (!bounds1 || !bounds2) return currentNodeId

    // Determine which side the port point is on for each node
    const side1 = this.classifyPortPointSide(portPoint, bounds1)
    const side2 = this.classifyPortPointSide(portPoint, bounds2)

    if (!side1 || !side2) return currentNodeId

    // Get side lengths
    const sides1 = this.mapOfNodeIdToLengthOfEachSide.get(nodeId1)
    const sides2 = this.mapOfNodeIdToLengthOfEachSide.get(nodeId2)

    if (!sides1 || !sides2) return currentNodeId

    const length1 = sides1[side1]
    const length2 = sides2[side2]

    // Return the node with smaller side length
    return length1 <= length2 ? nodeId1 : nodeId2
  }

  /**
   * Redistribute port points on a single side of a node to have better spacing
   */
  redistributePortPointsOnSide(
    nodeId: string,
    side: Side,
    portPoints: PortPointWithSide[],
  ): PortPointWithSide[] {
    if (portPoints.length === 0) return []

    const bounds = this.mapOfNodeIdToBounds.get(nodeId)
    const sides = this.mapOfNodeIdToLengthOfEachSide.get(nodeId)

    console.assert(bounds, `Bounds must exist for node ${nodeId}`)
    console.assert(sides, `Sides must exist for node ${nodeId}`)

    if (!bounds || !sides) return portPoints

    const sideLength = sides[side]
    const minSpacing = this.input.minTraceWidth + 0.15 // Add margin
    const edgeMargin = (minSpacing * 3) / 4

    // Calculate effective length (excluding margins)
    const effectiveLength = Math.max(0, sideLength - 2 * edgeMargin)

    // Group by z-layer
    const portsByZ = new Map<number, PortPointWithSide[]>()
    for (const port of portPoints) {
      const existing = portsByZ.get(port.z) ?? []
      existing.push(port)
      portsByZ.set(port.z, existing)
    }

    const redistributed: PortPointWithSide[] = []

    // Redistribute each z-layer independently
    for (const [_z, portsOnZ] of portsByZ) {
      const count = portsOnZ.length

      for (let i = 0; i < count; i++) {
        const originalPort = portsOnZ[i]

        // Calculate new position along the side
        let fraction: number
        if (count === 1) {
          fraction = 0.5
        } else {
          fraction =
            (edgeMargin + (effectiveLength * i) / (count - 1)) / sideLength
        }

        // Calculate new x, y based on side
        let newX: number
        let newY: number

        switch (side) {
          case "top":
            newX = bounds.minX + sideLength * fraction
            newY = bounds.maxY
            break
          case "bottom":
            newX = bounds.minX + sideLength * fraction
            newY = bounds.minY
            break
          case "left":
            newX = bounds.minX
            newY = bounds.minY + sideLength * fraction
            break
          case "right":
            newX = bounds.maxX
            newY = bounds.minY + sideLength * fraction
            break
        }

        console.assert(
          Number.isFinite(newX) && Number.isFinite(newY),
          `Calculated coordinates for port point must be finite: x=${newX}, y=${newY}`,
        )

        redistributed.push({
          ...originalPort,
          x: newX,
          y: newY,
        })
      }
    }

    return redistributed
  }

  step(): void {
    if (this.nodeAndSideKeyQueue.length <= 0) {
      // All sides processed, rebuild output nodes
      this.rebuildNodes()
      this.solved = true
      return
    }

    // Process one side at a time
    this.currentNodeAndSideKey = this.nodeAndSideKeyQueue.shift()!
    const [nodeId, side] = this.currentNodeAndSideKey.split(":") as [
      string,
      Side,
    ]

    // Ignore port points that are inside target nodes or connect to target nodes
    const allPortPoints =
      this.mapOfNodeAndSideToPortPoints.get(this.currentNodeAndSideKey) ?? []
    const portPoints = allPortPoints.filter((portPoint) => {
      return !this.shouldIgnorePortPoint(portPoint, nodeId)
    })

    // Redistribute port points on this side
    const redistributed = this.redistributePortPointsOnSide(
      nodeId,
      side,
      portPoints,
    )

    // Update the map with redistributed points
    this.mapOfNodeAndSideToPortPoints.set(
      this.currentNodeAndSideKey,
      redistributed,
    )
  }

  /**
   * Rebuild NodeWithPortPoints from the redistributed port points
   */
  rebuildNodes(): void {
    const nodeMap = new Map<string, NodeWithPortPoints>()

    // Initialize nodes from original input
    for (const node of this.input.nodeWithPortPoints) {
      nodeMap.set(node.capacityMeshNodeId, {
        ...node,
        portPoints: [],
      })
    }

    // Add redistributed port points to their nodes
    for (const [key, portPoints] of this.mapOfNodeAndSideToPortPoints) {
      const [nodeId] = key.split(":")

      const node = nodeMap.get(nodeId)
      if (!node) continue

      for (const portPoint of portPoints) {
        // Remove the side and ownerNodeId properties before adding
        const { side, ownerNodeId, ...cleanPortPoint } = portPoint
        node.portPoints.push(cleanPortPoint)
      }
    }

    this.redistributedNodes = Array.from(nodeMap.values())
  }

  getNodesWithPortPoints(): NodeWithPortPoints[] {
    return this.redistributedNodes
  }

  visualize(): GraphicsObject {
    const rects: Rect[] = []
    const lines: Line[] = []
    const points: Point[] = []

    this.input.obstacles.forEach(e => {
      rects.push({
        ...e,
        fill: "#00000037"
      })
    })

    // Draw port points
    for (const [_key, portPoints] of this.mapOfNodeAndSideToPortPoints) {
      for (const portPoint of portPoints) {
        points.push({
          x: portPoint.x,
          y: portPoint.y,
        })
      }
    }

    // Highlight current side being processed
    if (this.currentNodeAndSideKey) {
      const [nodeId, side] = this.currentNodeAndSideKey.split(":")
      const bounds = this.mapOfNodeIdToBounds.get(nodeId)
      if (bounds) {
        let x1: number, y1: number, x2: number, y2: number

        switch (side) {
          case "top":
            x1 = bounds.minX
            y1 = bounds.maxY
            x2 = bounds.maxX
            y2 = bounds.maxY
            break
          case "bottom":
            x1 = bounds.minX
            y1 = bounds.minY
            x2 = bounds.maxX
            y2 = bounds.minY
            break
          case "left":
            x1 = bounds.minX
            y1 = bounds.minY
            x2 = bounds.minX
            y2 = bounds.maxY
            break
          case "right":
            x1 = bounds.maxX
            y1 = bounds.minY
            x2 = bounds.maxX
            y2 = bounds.maxY
            break
          default:
            x1 = y1 = x2 = y2 = 0
        }

        lines.push({
          points: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ],
          strokeColor: "red",
          strokeWidth: 0.03,
        })
      }
    }

    return { rects, lines, points }
  }
}

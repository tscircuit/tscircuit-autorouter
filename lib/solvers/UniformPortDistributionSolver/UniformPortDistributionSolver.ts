import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject, Line } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { NodeAndSide, NodeBounds, PortPointWithSide, Side } from "./types"
import { classifyPortPointSide } from "./classifyPortPointSide"
import { redistributePortPointsOnSide } from "./redistributePortPointsOnSide"
import { determineOwnerNode } from "./determineOwnerNode"
import { shouldIgnorePortPoint } from "./shouldIgnorePortPoint"
import { shouldIgnoreSide } from "./shouldIgnoreSide"

export interface UniformPortDistributionSolverInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
  minTraceWidth: number
  layerCount: number
}

export class UniformPortDistributionSolver extends BaseSolver {
  mapOfNodeIdToLengthOfEachSide = new Map<string, Record<Side, number>>()
  nodeAndSideQueue: NodeAndSide[] = []
  mapOfNodeIdToBounds = new Map<string, NodeBounds>()
  mapOfNodeAndSideToPortPoints = new Map<string, PortPointWithSide[]>()
  currentNodeAndSide: NodeAndSide | null = null
  redistributedNodes: NodeWithPortPoints[] = []

  private getNodeAndSideKey({ nodeId, side }: NodeAndSide): string {
    return `${nodeId}:${side}`
  }

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    for (const node of input.nodeWithPortPoints) {
      const { width, height, center } = node
      this.mapOfNodeIdToLengthOfEachSide.set(node.capacityMeshNodeId, {
        left: height,
        right: height,
        top: width,
        bottom: width,
      })
      this.mapOfNodeIdToBounds.set(node.capacityMeshNodeId, {
        minX: center.x - width / 2,
        maxX: center.x + width / 2,
        minY: center.y - height / 2,
        maxY: center.y + height / 2,
      })
    }

    for (const node of input.nodeWithPortPoints) {
      const bounds = this.mapOfNodeIdToBounds.get(node.capacityMeshNodeId)!
      for (const portPoint of node.portPoints) {
        if (!portPoint.portPointId) continue
        const side = classifyPortPointSide({ portPoint, bounds })
        if (!side) continue
        const ownerNodeId = determineOwnerNode({
          portPoint,
          currentNodeId: node.capacityMeshNodeId,
          inputNodes: input.inputNodWithPortPoints,
          nodeBounds: this.mapOfNodeIdToBounds,
          sideLengths: this.mapOfNodeIdToLengthOfEachSide,
        })

        if (ownerNodeId !== node.capacityMeshNodeId) continue

        const nodeAndSide: NodeAndSide = { nodeId: ownerNodeId, side }
        const key = this.getNodeAndSideKey(nodeAndSide)
        const existing = this.mapOfNodeAndSideToPortPoints.get(key) ?? []
        existing.push({ ...portPoint, side, ownerNodeId })
        this.mapOfNodeAndSideToPortPoints.set(key, existing)

        if (
          !this.nodeAndSideQueue.some(
            (ns) => ns.nodeId === ownerNodeId && ns.side === side,
          )
        ) {
          this.nodeAndSideQueue.push(nodeAndSide)
        }
      }
    }
    this.nodeAndSideQueue.sort((a, b) => {
      const bA = this.mapOfNodeIdToBounds.get(a.nodeId)!
      const bB = this.mapOfNodeIdToBounds.get(b.nodeId)!
      return bA.minX - bB.minX || bA.minY - bB.minY
    })
  }

  step(): void {
    if (this.nodeAndSideQueue.length === 0) {
      this.rebuildNodes()
      this.solved = true
      return
    }
    this.currentNodeAndSide = this.nodeAndSideQueue.shift()!
    const { nodeId, side } = this.currentNodeAndSide

    if (
      shouldIgnoreSide({
        nodeId,
        side,
        nodeBounds: this.mapOfNodeIdToBounds,
        obstacles: this.input.obstacles,
      })
    ) {
      return
    }

    const key = this.getNodeAndSideKey(this.currentNodeAndSide)
    const portPoints = (
      this.mapOfNodeAndSideToPortPoints.get(key) ?? []
    ).filter(
      (p) =>
        !shouldIgnorePortPoint({
          portPoint: p,
          nodeId,
          inputNodes: this.input.inputNodWithPortPoints,
        }),
    )
    this.mapOfNodeAndSideToPortPoints.set(
      key,
      redistributePortPointsOnSide({
        side,
        portPoints,
        bounds: this.mapOfNodeIdToBounds.get(nodeId)!,
        sideLength: this.mapOfNodeIdToLengthOfEachSide.get(nodeId)![side],
      }),
    )
  }

  rebuildNodes(): void {
    const nodeMap = new Map<string, NodeWithPortPoints>(
      this.input.nodeWithPortPoints.map((n) => [
        n.capacityMeshNodeId,
        { ...n, portPoints: [] },
      ]),
    )

    // Map portPointId to its redistributed position (x, y only)
    const redistributedPositions = new Map<string, { x: number; y: number }>()
    for (const points of this.mapOfNodeAndSideToPortPoints.values()) {
      for (const p of points) {
        if (p.portPointId) {
          redistributedPositions.set(p.portPointId, { x: p.x, y: p.y })
        }
      }
    }

    // Rebuild nodes, preserving all port points but updating positions
    for (const node of this.input.nodeWithPortPoints) {
      const targetNode = nodeMap.get(node.capacityMeshNodeId)!
      for (const portPoint of node.portPoints) {
        if (
          portPoint.portPointId &&
          redistributedPositions.has(portPoint.portPointId)
        ) {
          const newPos = redistributedPositions.get(portPoint.portPointId)!
          targetNode.portPoints.push({
            ...portPoint,
            x: newPos.x,
            y: newPos.y,
          })
        } else {
          targetNode.portPoints.push(portPoint)
        }
      }
    }

    this.redistributedNodes = Array.from(nodeMap.values())
  }

  getOutput = () => this.redistributedNodes

  visualize(): GraphicsObject {
    const rects = this.input.obstacles.map((o) => ({ ...o, fill: "#00000037" }))
    const points: { x: number; y: number }[] = []
    const lines: Line[] = []

    // Create a map of portPointId to its most current position
    const portPointMap = new Map<string, { x: number; y: number }>()

    // Initialize with original positions
    for (const node of this.input.nodeWithPortPoints) {
      for (const pp of node.portPoints) {
        if (pp.portPointId) {
          portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
        }
      }
    }

    // Update with redistributed positions
    for (const portPoints of this.mapOfNodeAndSideToPortPoints.values()) {
      for (const pp of portPoints) {
        if (pp.portPointId) {
          portPointMap.set(pp.portPointId, { x: pp.x, y: pp.y })
        }
      }
    }

    // Collect all points for visualization
    for (const pos of portPointMap.values()) {
      points.push(pos)
    }

    // Draw connection lines using the updated positions
    this.input.nodeWithPortPoints.forEach((element) => {
      element.portPoints.forEach((e) => {
        if (!e.portPointId) return
        const posE = portPointMap.get(e.portPointId)!

        element.portPoints.forEach((f) => {
          if (!f.portPointId || e === f) return
          if (e.connectionName === f.connectionName) {
            const posF = portPointMap.get(f.portPointId)!
            lines.push({
              points: [posE, posF],
              strokeColor: "#fff822c9",
            })
          }
        })
      })
    })

    for (const { nodeId, side } of this.nodeAndSideQueue) {
      const b = this.mapOfNodeIdToBounds.get(nodeId)!
      let x1 = 0,
        y1 = 0,
        x2 = 0,
        y2 = 0
      if (side === "top") {
        x1 = b.minX
        y1 = b.maxY
        x2 = b.maxX
        y2 = b.maxY
      } else if (side === "bottom") {
        x1 = b.minX
        y1 = b.minY
        x2 = b.maxX
        y2 = b.minY
      } else if (side === "left") {
        x1 = b.minX
        y1 = b.minY
        x2 = b.minX
        y2 = b.maxY
      } else if (side === "right") {
        x1 = b.maxX
        y1 = b.minY
        x2 = b.maxX
        y2 = b.maxY
      }
      lines.push({
        points: [
          { x: x1, y: y1 },
          { x: x2, y: y2 },
        ],
        strokeColor: "orange",
        strokeWidth: 0.01,
      })
    }

    if (this.currentNodeAndSide) {
      const { nodeId, side } = this.currentNodeAndSide
      const b = this.mapOfNodeIdToBounds.get(nodeId)!
      let x1 = 0,
        y1 = 0,
        x2 = 0,
        y2 = 0
      if (side === "top") {
        x1 = b.minX
        y1 = b.maxY
        x2 = b.maxX
        y2 = b.maxY
      } else if (side === "bottom") {
        x1 = b.minX
        y1 = b.minY
        x2 = b.maxX
        y2 = b.minY
      } else if (side === "left") {
        x1 = b.minX
        y1 = b.minY
        x2 = b.minX
        y2 = b.maxY
      } else if (side === "right") {
        x1 = b.maxX
        y1 = b.minY
        x2 = b.maxX
        y2 = b.maxY
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
    return { rects, lines, points }
  }
}

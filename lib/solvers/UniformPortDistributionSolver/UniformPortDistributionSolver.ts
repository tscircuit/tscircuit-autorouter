import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject, Line } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { NodeBounds, PortPointWithSide, Side } from "./types"
import { classifyPortPointSide } from "./classifyPortPointSide"
import { redistributePortPointsOnSide } from "./redistributePortPointsOnSide"

export interface UniformPortDistributionSolverInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
  minTraceWidth: number
  layerCount: number
}

export class UniformPortDistributionSolver extends BaseSolver {
  mapOfNodeIdToLengthOfEachSide = new Map<string, Record<Side, number>>()
  nodeAndSideKeyQueue: string[] = []
  mapOfNodeIdToBounds = new Map<string, NodeBounds>()
  mapOfNodeAndSideToPortPoints = new Map<string, PortPointWithSide[]>()
  currentNodeAndSideKey: string | null = null
  redistributedNodes: NodeWithPortPoints[] = []

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    for (const node of input.nodeWithPortPoints) {
      const { width, height, center } = node
      this.mapOfNodeIdToLengthOfEachSide.set(node.capacityMeshNodeId, {
        left: height, right: height, top: width, bottom: width,
      })
      this.mapOfNodeIdToBounds.set(node.capacityMeshNodeId, {
        minX: center.x - width / 2, maxX: center.x + width / 2,
        minY: center.y - height / 2, maxY: center.y + height / 2,
      })
    }

    for (const node of input.nodeWithPortPoints) {
      const bounds = this.mapOfNodeIdToBounds.get(node.capacityMeshNodeId)!
      for (const portPoint of node.portPoints) {
        if (!portPoint.portPointId) continue
        const side = classifyPortPointSide({ portPoint, bounds })
        if (!side) continue
        const ownerNodeId = this.determineOwnerNode(
          portPoint,
          node.capacityMeshNodeId,
        )

        if (ownerNodeId !== node.capacityMeshNodeId) continue

        const key = `${ownerNodeId}:${side}`
        const existing = this.mapOfNodeAndSideToPortPoints.get(key) ?? []
        existing.push({ ...portPoint, side, ownerNodeId })
        this.mapOfNodeAndSideToPortPoints.set(key, existing)
      }
    }
    this.nodeAndSideKeyQueue = Array.from(
      this.mapOfNodeAndSideToPortPoints.keys(),
    ).sort((a, b) => {
      const [idA] = a.split(":")
      const [idB] = b.split(":")
      const bA = this.mapOfNodeIdToBounds.get(idA)!
      const bB = this.mapOfNodeIdToBounds.get(idB)!
      return bA.minX - bB.minX || bA.minY - bB.minY
    })
  }

  determineOwnerNode(portPoint: PortPoint, currentNodeId: string): string {
    const inputNode = this.input.inputNodWithPortPoints.find(n => n.capacityMeshNodeId === currentNodeId)
    const inputPortPoint = inputNode?.portPoints.find(p => p.portPointId === portPoint.portPointId)
    if (!inputPortPoint?.connectionNodeIds || inputPortPoint.connectionNodeIds.length !== 2) return currentNodeId
    const [n1, n2] = inputPortPoint.connectionNodeIds
    const b1 = this.mapOfNodeIdToBounds.get(n1), b2 = this.mapOfNodeIdToBounds.get(n2)
    if (!b1 || !b2) return currentNodeId
    const s1 = classifyPortPointSide({ portPoint, bounds: b1 }), s2 = classifyPortPointSide({ portPoint, bounds: b2 })
    if (!s1 || !s2) return currentNodeId
    return this.mapOfNodeIdToLengthOfEachSide.get(n1)![s1] <= this.mapOfNodeIdToLengthOfEachSide.get(n2)![s2] ? n1 : n2
  }

  shouldIgnorePortPoint(portPoint: PortPoint, nodeId: string): boolean {
    const inputNode = this.input.inputNodWithPortPoints.find(n => n.capacityMeshNodeId === nodeId)
    if (inputNode?._containsTarget) return true
    const ipp = inputNode?.portPoints.find(p => p.portPointId === portPoint.portPointId)
    return ipp?.connectionNodeIds?.some(id => this.input.inputNodWithPortPoints.find(n => n.capacityMeshNodeId === id)?._containsTarget) ?? false
  }

  shouldIgnoreSide(nodeId: string, side: Side): boolean {
    const bounds = this.mapOfNodeIdToBounds.get(nodeId)!

    for (const obstacle of this.input.obstacles) {
      const margin = 0.001
      const obsMinX = obstacle.center.x - obstacle.width / 2
      const obsMaxX = obstacle.center.x + obstacle.width / 2
      const obsMinY = obstacle.center.y - obstacle.height / 2
      const obsMaxY = obstacle.center.y + obstacle.height / 2

      // Check if the side is fully or partially inside the obstacle
      // A side is ignored only if it's strictly inside the obstacle bounds
      switch (side) {
        case "top":
          if (Math.abs(bounds.maxY - obsMinY) < margin || Math.abs(bounds.maxY - obsMaxY) < margin) {
            // Check if the side segment overlaps with the obstacle segment
            const overlapMinX = Math.max(bounds.minX, obsMinX)
            const overlapMaxX = Math.min(bounds.maxX, obsMaxX)
            if (overlapMaxX - overlapMinX > margin) return true
          }
          break
        case "bottom":
          if (Math.abs(bounds.minY - obsMinY) < margin || Math.abs(bounds.minY - obsMaxY) < margin) {
            const overlapMinX = Math.max(bounds.minX, obsMinX)
            const overlapMaxX = Math.min(bounds.maxX, obsMaxX)
            if (overlapMaxX - overlapMinX > margin) return true
          }
          break
        case "left":
          if (Math.abs(bounds.minX - obsMinX) < margin || Math.abs(bounds.minX - obsMaxX) < margin) {
            const overlapMinY = Math.max(bounds.minY, obsMinY)
            const overlapMaxY = Math.min(bounds.maxY, obsMaxY)
            if (overlapMaxY - overlapMinY > margin) return true
          }
          break
        case "right":
          if (Math.abs(bounds.maxX - obsMinX) < margin || Math.abs(bounds.maxX - obsMaxX) < margin) {
            const overlapMinY = Math.max(bounds.minY, obsMinY)
            const overlapMaxY = Math.min(bounds.maxY, obsMaxY)
            if (overlapMaxY - overlapMinY > margin) return true
          }
          break
      }
    }
    return false
  }

  step(): void {
    if (this.nodeAndSideKeyQueue.length === 0) {
      this.rebuildNodes()
      this.solved = true
      return
    }
    this.currentNodeAndSideKey = this.nodeAndSideKeyQueue.shift()!
    const [nodeId, side] = this.currentNodeAndSideKey.split(":") as [
      string,
      Side,
    ]

    if (this.shouldIgnoreSide(nodeId, side)) {
      return
    }

    const portPoints = (
      this.mapOfNodeAndSideToPortPoints.get(this.currentNodeAndSideKey) ?? []
    ).filter((p) => !this.shouldIgnorePortPoint(p, nodeId))
    this.mapOfNodeAndSideToPortPoints.set(
      this.currentNodeAndSideKey,
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

    // Add all port points from the input that were NOT redistributed
    // (e.g. those in target nodes or those that weren't "owned" by any side)
    for (const node of this.input.nodeWithPortPoints) {
      const targetNode = nodeMap.get(node.capacityMeshNodeId)!
      for (const portPoint of node.portPoints) {
        const bounds = this.mapOfNodeIdToBounds.get(node.capacityMeshNodeId)!
        const side = classifyPortPointSide({ portPoint, bounds })
        const ownerNodeId = side
          ? this.determineOwnerNode(portPoint, node.capacityMeshNodeId)
          : null

        if (!side || ownerNodeId !== node.capacityMeshNodeId) {
          targetNode.portPoints.push(portPoint)
        }
      }
    }

    // Add redistributed port points
    for (const [key, points] of this.mapOfNodeAndSideToPortPoints) {
      const node = nodeMap.get(key.split(":")[0])
      if (node) {
        node.portPoints.push(...points.map(({ side, ownerNodeId, ...p }) => p))
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

    for (const key of this.nodeAndSideKeyQueue) {
      const [id, side] = key.split(":")
      const b = this.mapOfNodeIdToBounds.get(id)!
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0
      if (side === "top") { x1 = b.minX; y1 = b.maxY; x2 = b.maxX; y2 = b.maxY }
      else if (side === "bottom") { x1 = b.minX; y1 = b.minY; x2 = b.maxX; y2 = b.minY }
      else if (side === "left") { x1 = b.minX; y1 = b.minY; x2 = b.minX; y2 = b.maxY }
      else if (side === "right") { x1 = b.maxX; y1 = b.minY; x2 = b.maxX; y2 = b.maxY }
      lines.push({ points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], strokeColor: "orange", strokeWidth: 0.01 })
    }

    if (this.currentNodeAndSideKey) {
      const [id, side] = this.currentNodeAndSideKey.split(":")
      const b = this.mapOfNodeIdToBounds.get(id)!
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0
      if (side === "top") { x1 = b.minX; y1 = b.maxY; x2 = b.maxX; y2 = b.maxY }
      else if (side === "bottom") { x1 = b.minX; y1 = b.minY; x2 = b.maxX; y2 = b.minY }
      else if (side === "left") { x1 = b.minX; y1 = b.minY; x2 = b.minX; y2 = b.maxY }
      else if (side === "right") { x1 = b.maxX; y1 = b.minY; x2 = b.maxX; y2 = b.maxY }
      lines.push({ points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], strokeColor: "red", strokeWidth: 0.03 })
    }
    return { rects, lines, points }
  }
}

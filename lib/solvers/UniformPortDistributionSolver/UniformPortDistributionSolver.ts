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
        const ownerNodeId = this.determineOwnerNode(portPoint, node.capacityMeshNodeId)
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

  step(): void {
    if (this.nodeAndSideKeyQueue.length === 0) {
      this.rebuildNodes()
      this.solved = true
      return
    }
    this.currentNodeAndSideKey = this.nodeAndSideKeyQueue.shift()!
    const [nodeId, side] = this.currentNodeAndSideKey.split(":") as [string, Side]
    // TODO: i think this is a todo skip port points if they are on obstical or allow entry exti to a obsitlca
    const portPoints = (this.mapOfNodeAndSideToPortPoints.get(this.currentNodeAndSideKey) ?? [])
      .filter(p => !this.shouldIgnorePortPoint(p, nodeId))
    this.mapOfNodeAndSideToPortPoints.set(this.currentNodeAndSideKey, redistributePortPointsOnSide({
      side, portPoints, bounds: this.mapOfNodeIdToBounds.get(nodeId)!,
      sideLength: this.mapOfNodeIdToLengthOfEachSide.get(nodeId)![side]
    }))
  }

  rebuildNodes(): void {
    const nodeMap = new Map<string, NodeWithPortPoints>(
      this.input.nodeWithPortPoints.map((n) => [
        n.capacityMeshNodeId,
        { ...n, portPoints: [] },
      ]),
    )
    for (const [key, points] of this.mapOfNodeAndSideToPortPoints) {
      const node = nodeMap.get(key.split(":")[0])
      if (node) {
        node.portPoints.push(
          ...points.map(({ side, ownerNodeId, ...p }) => p),
        )
      }
    }
    this.redistributedNodes = Array.from(nodeMap.values())
  }

  getOutput = () => this.redistributedNodes

  visualize(): GraphicsObject {
    const rects = this.input.obstacles.map(o => ({ ...o, fill: "#00000037" }))
    const points = Array.from(this.mapOfNodeAndSideToPortPoints.values()).flat().map(p => ({ x: p.x, y: p.y }))
    const lines: Line[] = []

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

import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { NodeAndSide, NodeBounds, PortPointWithSide, Side } from "./types"
import { classifyPortPointSide } from "./classifyPortPointSide"
import { redistributePortPointsOnSide } from "./redistributePortPointsOnSide"
import { determineOwnerNode } from "./determineOwnerNode"
import { shouldIgnorePortPoint } from "./shouldIgnorePortPoint"
import { shouldIgnoreSide } from "./shouldIgnoreSide"
import { visualizeUniformPortDistribution } from "./visualizeUniformPortDistribution"

export interface UniformPortDistributionSolverInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
  minTraceWidth: number
  layerCount: number
}

export class UniformPortDistributionSolver extends BaseSolver {
  mapOfNodeIdToLengthOfEachSide = new Map<string, Record<Side, number>>()
  sidesToProcess: NodeAndSide[] = []
  mapOfNodeIdToBounds = new Map<string, NodeBounds>()
  mapOfNodeAndSideToPortPoints = new Map<string, PortPointWithSide[]>()
  currentSideBeingProcessed: NodeAndSide | null = null
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
          !this.sidesToProcess.some(
            (ns) => ns.nodeId === ownerNodeId && ns.side === side,
          )
        ) {
          this.sidesToProcess.push(nodeAndSide)
        }
      }
    }
    this.sidesToProcess.sort((a, b) => {
      const bA = this.mapOfNodeIdToBounds.get(a.nodeId)!
      const bB = this.mapOfNodeIdToBounds.get(b.nodeId)!
      return bA.minX - bB.minX || bA.minY - bB.minY
    })
  }

  step(): void {
    if (this.sidesToProcess.length === 0) {
      this.rebuildNodes()
      this.solved = true
      return
    }
    this.currentSideBeingProcessed = this.sidesToProcess.shift()!
    const { nodeId, side } = this.currentSideBeingProcessed

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

    const key = this.getNodeAndSideKey(this.currentSideBeingProcessed)
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
    return visualizeUniformPortDistribution({
      obstacles: this.input.obstacles,
      nodeWithPortPoints: this.input.nodeWithPortPoints,
      mapOfNodeAndSideToPortPoints: this.mapOfNodeAndSideToPortPoints,
      sidesToProcess: this.sidesToProcess,
      currentSideBeingProcessed: this.currentSideBeingProcessed,
      mapOfNodeIdToBounds: this.mapOfNodeIdToBounds,
    })
  }
}

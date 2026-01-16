import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { NodeAndSide, Bounds, PortPointWithSide, Side } from "./types"
import { classifyPortPointSide } from "./classifyPortPointSide"
import { redistributePortPointsOnSide } from "./redistributePortPointsOnSide"
import { determineOwnerNode } from "./determineOwnerNode"
import { shouldIgnorePortPoint } from "./shouldIgnorePortPoint"
import { shouldIgnoreSide } from "./shouldIgnoreSide"
import { visualizeUniformPortDistribution } from "./visualizeUniformPortDistribution"

export interface UniformPortDistributionSolverInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodesWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
}

/**
 * Redistributes port points uniformly along the sides of nodes to optimize
 * routing density and prevent congestion.
 *
 * This solver:
 * 1. Classifies which side of a node each port point belongs to.
 * 2. Determines the "owner" node for port points shared between nodes.
 * 3. Evenly spaces port points along their assigned side.
 */
export class UniformPortDistributionSolver extends BaseSolver {
  mapOfNodeIdToLengthOfEachSide = new Map<string, Record<Side, number>>()
  sidesToProcess: NodeAndSide[] = []
  mapOfNodeIdToBounds = new Map<string, Bounds>()
  mapOfNodeAndSideToPortPoints = new Map<string, PortPointWithSide[]>()
  currentSideBeingProcessed: NodeAndSide | null = null
  redistributedNodes: NodeWithPortPoints[] = []

  private getNodeAndSideKey({ nodeId, side }: NodeAndSide): string {
    return `${nodeId}:${side}`
  }

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    for (const node of input.nodeWithPortPoints) {
      const { width, height } = node
      this.mapOfNodeIdToLengthOfEachSide.set(node.capacityMeshNodeId, {
        left: height,
        right: height,
        top: width,
        bottom: width,
      })
      this.mapOfNodeIdToBounds.set(
        node.capacityMeshNodeId,
        getBoundsFromNodeWithPortPoints(node),
      )
    }

    const processedSides = new Set<string>()
    for (const node of input.nodeWithPortPoints) {
      const bounds = this.mapOfNodeIdToBounds.get(node.capacityMeshNodeId)!
      for (const portPoint of node.portPoints) {
        if (!portPoint.portPointId) continue
        const side = classifyPortPointSide({ portPoint, bounds })
        if (!side) continue
        const ownerNodeId = determineOwnerNode({
          portPoint,
          currentNodeId: node.capacityMeshNodeId,
          inputNodes: input.inputNodesWithPortPoints,
          nodeBounds: this.mapOfNodeIdToBounds,
          sideLengths: this.mapOfNodeIdToLengthOfEachSide,
        })

        if (ownerNodeId !== node.capacityMeshNodeId) continue

        const nodeAndSide: NodeAndSide = { nodeId: ownerNodeId, side }
        const key = this.getNodeAndSideKey(nodeAndSide)
        const existing = this.mapOfNodeAndSideToPortPoints.get(key) ?? []
        existing.push({ ...portPoint, side, ownerNodeId })
        this.mapOfNodeAndSideToPortPoints.set(key, existing)

        if (!processedSides.has(key)) {
          processedSides.add(key)
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

    const bounds = this.mapOfNodeIdToBounds.get(nodeId)!
    const sideLengthRecord = this.mapOfNodeIdToLengthOfEachSide.get(nodeId)!
    const sideLength = sideLengthRecord[side]

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
    const portPointsRaw = this.mapOfNodeAndSideToPortPoints.get(key) ?? []
    const portPoints: PortPointWithSide[] = []

    for (const p of portPointsRaw) {
      if (
        !shouldIgnorePortPoint({
          portPoint: p,
          nodeId,
          inputNodes: this.input.inputNodesWithPortPoints,
        })
      ) {
        portPoints.push(p)
      }
    }

    this.mapOfNodeAndSideToPortPoints.set(
      key,
      redistributePortPointsOnSide({
        side,
        portPoints,
        bounds,
        sideLength,
      }),
    )
  }

  rebuildNodes(): void {
    const redistributedPositions = new Map<string, { x: number; y: number }>()
    for (const points of this.mapOfNodeAndSideToPortPoints.values()) {
      for (const p of points) {
        if (p.portPointId) {
          redistributedPositions.set(p.portPointId, { x: p.x, y: p.y })
        }
      }
    }

    this.redistributedNodes = this.input.nodeWithPortPoints.map((node) => ({
      ...node,
      portPoints: node.portPoints.map((portPoint) => {
        if (
          portPoint.portPointId &&
          redistributedPositions.has(portPoint.portPointId)
        ) {
          const newPos = redistributedPositions.get(portPoint.portPointId)!
          return { ...portPoint, x: newPos.x, y: newPos.y }
        }
        return portPoint
      }),
    }))
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

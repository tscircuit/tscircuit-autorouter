import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import type { Obstacle } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import {
  Bounds,
  OwnerPair,
  OwnerPairKey,
  PortPointWithOwnerPair,
  SharedEdge,
} from "./types"
import { determineOwnerPair } from "./determineOwnerPair"
import { getOwnerPairKey } from "./getOwnerPairKey"
import { precomputeSharedEdges } from "./precomputeSharedEdges"
import { redistributePortPointsOnSharedEdge } from "./redistributePortPointsOnSharedEdge"
import { shouldIgnorePortPoint } from "./shouldIgnorePortPoint"
import { shouldIgnoreSharedEdge } from "./shouldIgnoreSharedEdge"
import { visualizeUniformPortDistribution } from "./visualizeUniformPortDistribution"

export interface UniformPortDistributionSolverInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodesWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
  minTraceWidth: number
  traceClearance: number
}

/**
 * Redistributes port points uniformly along the sides of nodes to optimize
 * routing density and prevent congestion.
 *
 * This solver:
 * 1. Determines an owner pair of capacity nodes for each port point.
 * 2. Precomputes the shared edge for each owner pair.
 * 3. Evenly spaces "family" port points along their shared edge.
 */
export class UniformPortDistributionSolver extends BaseSolver {
  override getSolverName(): string {
    return "UniformPortDistributionSolver"
  }

  mapOfNodeIdToBounds = new Map<string, Bounds>()
  mapOfOwnerPairToPortPoints = new Map<OwnerPairKey, PortPointWithOwnerPair[]>()
  mapOfOwnerPairToSharedEdge = new Map<OwnerPairKey, SharedEdge>()
  ownerPairsToProcess: OwnerPairKey[] = []
  currentOwnerPairBeingProcessed: OwnerPairKey | null = null
  redistributedNodes: NodeWithPortPoints[] = []
  allPortPoints: PortPoint[] = []
  fixedPortPointIds = new Set<string>()

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    for (const node of input.nodeWithPortPoints) {
      this.mapOfNodeIdToBounds.set(
        node.capacityMeshNodeId,
        getBoundsFromNodeWithPortPoints(node),
      )
    }

    const uniqueOwnerPairs = new Map<OwnerPairKey, OwnerPair>()
    for (const node of input.nodeWithPortPoints) {
      for (const portPoint of node.portPoints) {
        if (!portPoint.portPointId) continue
        const ownerNodeIds = determineOwnerPair({
          portPointId: portPoint.portPointId,
          currentNodeId: node.capacityMeshNodeId,
          inputNodes: input.inputNodesWithPortPoints,
        })
        const ownerPairKey = getOwnerPairKey(ownerNodeIds)
        const existing = this.mapOfOwnerPairToPortPoints.get(ownerPairKey) ?? []
        const alreadyPresent = existing.some(
          (point) =>
            point.portPointId && point.portPointId === portPoint.portPointId,
        )
        if (!alreadyPresent) {
          existing.push({
            ...portPoint,
            ownerNodeIds,
            ownerPairKey,
          })
        }
        this.mapOfOwnerPairToPortPoints.set(ownerPairKey, existing)
        uniqueOwnerPairs.set(ownerPairKey, ownerNodeIds)
      }
    }

    this.mapOfOwnerPairToSharedEdge = precomputeSharedEdges({
      ownerPairs: Array.from(uniqueOwnerPairs.values()),
      nodeBounds: this.mapOfNodeIdToBounds,
    })

    this.allPortPoints = input.nodeWithPortPoints.flatMap(
      (node) => node.portPoints,
    )
    for (const [ownerPairKey, portPoints] of this.mapOfOwnerPairToPortPoints) {
      const sharedEdge = this.mapOfOwnerPairToSharedEdge.get(ownerPairKey)
      const edgeIsFixed =
        !sharedEdge ||
        shouldIgnoreSharedEdge({
          sharedEdge,
          obstacles: this.input.obstacles,
        })
      for (const portPoint of portPoints) {
        if (
          portPoint.portPointId &&
          (edgeIsFixed ||
            shouldIgnorePortPoint({
              portPoint,
              ownerNodeIds: portPoint.ownerNodeIds,
              inputNodes: this.input.inputNodesWithPortPoints,
            }))
        ) {
          this.fixedPortPointIds.add(portPoint.portPointId)
        }
      }
    }

    this.ownerPairsToProcess = Array.from(
      this.mapOfOwnerPairToSharedEdge.keys(),
    )
    this.ownerPairsToProcess.sort((a, b) => {
      const edgeA = this.mapOfOwnerPairToSharedEdge.get(a)!
      const edgeB = this.mapOfOwnerPairToSharedEdge.get(b)!
      return edgeA.center.x - edgeB.center.x || edgeA.center.y - edgeB.center.y
    })
  }

  private redistributionIntroducesFixedPortPointCollision(
    redistributedPortPoints: PortPointWithOwnerPair[],
  ): boolean {
    const requiredClearance =
      this.input.minTraceWidth + this.input.traceClearance

    return redistributedPortPoints.some((redistributedPortPoint) => {
      const originalPortPoint = this.allPortPoints.find(
        (portPoint) =>
          portPoint.portPointId === redistributedPortPoint.portPointId,
      )
      if (!originalPortPoint) return false

      return this.allPortPoints.some((fixedPortPoint) => {
        if (
          !fixedPortPoint.portPointId ||
          fixedPortPoint.portPointId === redistributedPortPoint.portPointId ||
          !this.fixedPortPointIds.has(fixedPortPoint.portPointId) ||
          (fixedPortPoint.z ?? 0) !== (redistributedPortPoint.z ?? 0)
        ) {
          return false
        }
        const originalDistance = Math.hypot(
          fixedPortPoint.x - originalPortPoint.x,
          fixedPortPoint.y - originalPortPoint.y,
        )
        const redistributedDistance = Math.hypot(
          fixedPortPoint.x - redistributedPortPoint.x,
          fixedPortPoint.y - redistributedPortPoint.y,
        )
        return (
          originalDistance >= requiredClearance &&
          redistributedDistance < requiredClearance
        )
      })
    })
  }

  step(): void {
    if (this.ownerPairsToProcess.length === 0) {
      this.rebuildNodes()
      this.solved = true
      return
    }

    this.currentOwnerPairBeingProcessed = this.ownerPairsToProcess.shift()!
    const ownerPairKey = this.currentOwnerPairBeingProcessed
    const sharedEdge = this.mapOfOwnerPairToSharedEdge.get(ownerPairKey)
    if (!sharedEdge) return

    if (
      shouldIgnoreSharedEdge({ sharedEdge, obstacles: this.input.obstacles })
    ) {
      return
    }

    const familyRaw = this.mapOfOwnerPairToPortPoints.get(ownerPairKey) ?? []
    const family: PortPointWithOwnerPair[] = []
    for (const portPoint of familyRaw) {
      if (
        !shouldIgnorePortPoint({
          portPoint,
          ownerNodeIds: portPoint.ownerNodeIds,
          inputNodes: this.input.inputNodesWithPortPoints,
        })
      ) {
        family.push(portPoint)
      }
    }

    const redistributed = redistributePortPointsOnSharedEdge({
      sharedEdge,
      portPoints: family,
    })
    if (this.redistributionIntroducesFixedPortPointCollision(redistributed)) {
      return
    }

    this.mapOfOwnerPairToPortPoints.set(ownerPairKey, redistributed)
  }

  rebuildNodes(): void {
    const redistributedPositions = new Map<string, { x: number; y: number }>()
    for (const points of this.mapOfOwnerPairToPortPoints.values()) {
      for (const p of points) {
        if (p.portPointId) {
          redistributedPositions.set(p.portPointId, { x: p.x, y: p.y })
        }
      }
    }

    const updatePortPointPosition = <
      T extends { portPointId?: string; x: number; y: number },
    >(
      portPoint: T,
    ): T => {
      if (
        portPoint.portPointId &&
        redistributedPositions.has(portPoint.portPointId)
      ) {
        const newPos = redistributedPositions.get(portPoint.portPointId)!
        return { ...portPoint, x: newPos.x, y: newPos.y }
      }
      return portPoint
    }

    this.redistributedNodes = this.input.nodeWithPortPoints.map((node) => ({
      ...node,
      portPoints: node.portPoints.map(updatePortPointPosition),
      portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
        updatePortPointPosition(start),
        updatePortPointPosition(end),
      ]),
    }))
  }

  getOutput = () => this.redistributedNodes

  visualize(): GraphicsObject {
    return visualizeUniformPortDistribution({
      obstacles: this.input.obstacles,
      nodeWithPortPoints: this.input.nodeWithPortPoints,
      mapOfOwnerPairToPortPoints: this.mapOfOwnerPairToPortPoints,
      mapOfOwnerPairToSharedEdge: this.mapOfOwnerPairToSharedEdge,
      ownerPairsToProcess: this.ownerPairsToProcess,
      currentOwnerPairBeingProcessed: this.currentOwnerPairBeingProcessed,
      mapOfNodeIdToBounds: this.mapOfNodeIdToBounds,
    })
  }
}

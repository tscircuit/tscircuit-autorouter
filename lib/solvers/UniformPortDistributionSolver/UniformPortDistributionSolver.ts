import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { Obstacle } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import type { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import {
  Bounds,
  OwnerPair,
  OwnerPairKey,
  PortPointWithOwnerPair,
  SharedEdge,
} from "./types"
import {
  determineOwnerPair,
  indexPortPointOwnerNodes,
} from "./determineOwnerPair"
import { getOwnerPairKey } from "./getOwnerPairKey"
import { precomputeSharedEdges } from "./precomputeSharedEdges"
import { redistributePortPointsOnSharedEdge } from "./redistributePortPointsOnSharedEdge"
import {
  type InputNodeById,
  indexInputNodesById,
  shouldIgnorePortPoint,
} from "./shouldIgnorePortPoint"
import {
  SHARED_EDGE_EPSILON,
  shouldIgnoreSharedEdge,
} from "./shouldIgnoreSharedEdge"
import { visualizeUniformPortDistribution } from "./visualizeUniformPortDistribution"

export interface UniformPortDistributionSolverInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodesWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
  layerCount?: number
  /** Redistribute using physical bounds and per-layer obstacles. */
  useLayerAwareGeometry?: boolean
  preserveSolitaryPorts?: boolean
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
  private readonly obstacleIndex: ObstacleSpatialHashIndex
  private readonly inputNodeById: InputNodeById

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    this.obstacleIndex = new ObstacleSpatialHashIndex(
      "flatbush",
      input.obstacles,
    )
    this.inputNodeById = indexInputNodesById(input.inputNodesWithPortPoints)
    for (const node of input.nodeWithPortPoints) {
      // Off-edge duplicate ports must not expand the rectangles used to find
      // adjacency, or the shared edge disappears before we can space them.
      this.mapOfNodeIdToBounds.set(
        node.capacityMeshNodeId,
        !input.useLayerAwareGeometry
          ? getBoundsFromNodeWithPortPoints(node)
          : {
              minX: node.center.x - node.width / 2,
              maxX: node.center.x + node.width / 2,
              minY: node.center.y - node.height / 2,
              maxY: node.center.y + node.height / 2,
            },
      )
    }

    const uniqueOwnerPairs = new Map<OwnerPairKey, OwnerPair>()
    const connectionNodeIdsByPortPointId = indexPortPointOwnerNodes(
      input.inputNodesWithPortPoints,
    )
    for (const node of input.nodeWithPortPoints) {
      for (const portPoint of node.portPoints) {
        if (!portPoint.portPointId) continue
        const ownerNodeIds = determineOwnerPair({
          portPointId: portPoint.portPointId,
          currentNodeId: node.capacityMeshNodeId,
          inputNodes: input.inputNodesWithPortPoints,
          connectionNodeIdsByPortPointId,
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

    this.ownerPairsToProcess = Array.from(
      this.mapOfOwnerPairToSharedEdge.keys(),
    )
    this.ownerPairsToProcess.sort((a, b) => {
      const edgeA = this.mapOfOwnerPairToSharedEdge.get(a)!
      const edgeB = this.mapOfOwnerPairToSharedEdge.get(b)!
      return edgeA.center.x - edgeB.center.x || edgeA.center.y - edgeB.center.y
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

    const familyRaw = this.mapOfOwnerPairToPortPoints.get(ownerPairKey) ?? []
    const edgeObstacles = this.obstacleIndex.search({
      minX: Math.min(sharedEdge.x1, sharedEdge.x2) - SHARED_EDGE_EPSILON,
      minY: Math.min(sharedEdge.y1, sharedEdge.y2) - SHARED_EDGE_EPSILON,
      maxX: Math.max(sharedEdge.x1, sharedEdge.x2) + SHARED_EDGE_EPSILON,
      maxY: Math.max(sharedEdge.y1, sharedEdge.y2) + SHARED_EDGE_EPSILON,
    })
    const blockedOnAnotherLayer = shouldIgnoreSharedEdge({
      sharedEdge,
      obstacles: edgeObstacles,
    })
    if (!this.input.useLayerAwareGeometry && blockedOnAnotherLayer) return
    const portCountByLayer = new Map<number, number>()
    for (const portPoint of familyRaw) {
      portCountByLayer.set(
        portPoint.z,
        (portCountByLayer.get(portPoint.z) ?? 0) + 1,
      )
    }
    const family: PortPointWithOwnerPair[] = []
    const blockedByLayer = new Map<number, boolean>()
    for (const portPoint of familyRaw) {
      // A solitary crossing already has all the available spacing. Preserve
      // its obstacle-aligned placement rather than moving it into fixed copper.
      if (
        this.input.preserveSolitaryPorts &&
        blockedOnAnotherLayer &&
        portCountByLayer.get(portPoint.z) === 1
      ) {
        continue
      }
      const obstacleLayer = this.input.useLayerAwareGeometry
        ? portPoint.z
        : undefined
      let blockedOnPortLayer = blockedOnAnotherLayer
      if (obstacleLayer !== undefined) {
        blockedOnPortLayer = blockedByLayer.get(obstacleLayer) ?? false
        if (!blockedByLayer.has(obstacleLayer)) {
          blockedOnPortLayer = shouldIgnoreSharedEdge({
            sharedEdge,
            obstacles: edgeObstacles,
            z: obstacleLayer,
            layerCount: this.input.layerCount,
          })
          blockedByLayer.set(obstacleLayer, blockedOnPortLayer)
        }
      }
      if (
        !blockedOnPortLayer &&
        !shouldIgnorePortPoint({
          portPoint,
          ownerNodeIds: portPoint.ownerNodeIds,
          inputNodeById: this.inputNodeById,
        })
      ) {
        family.push(portPoint)
      }
    }

    const redistributed = redistributePortPointsOnSharedEdge({
      sharedEdge,
      portPoints: family,
    })

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

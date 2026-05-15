import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
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

type OrderedPortPoint = NodeWithPortPoints["portPoints"][number] & {
  _tinyRouteId?: number
  _tinyRegionSegmentIndex?: number
  _tinySegmentEndpointIndex?: 0 | 1
}

type OrderedNodeWithPortPoints = Omit<NodeWithPortPoints, "portPoints"> & {
  portPoints: OrderedPortPoint[]
}

type OrderedPortPointWithOwnerPair = PortPointWithOwnerPair & OrderedPortPoint

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
 * 1. Determines an owner pair of capacity nodes for each port point.
 * 2. Precomputes the shared edge for each owner pair.
 * 3. Evenly spaces "family" port points along their shared edge.
 */
export class UniformPortDistributionSolver extends BaseSolver {
  override getSolverName(): string {
    return "UniformPortDistributionSolver"
  }

  mapOfNodeIdToBounds = new Map<string, Bounds>()
  mapOfOwnerPairToPortPoints = new Map<
    OwnerPairKey,
    OrderedPortPointWithOwnerPair[]
  >()
  mapOfOwnerPairToSharedEdge = new Map<OwnerPairKey, SharedEdge>()
  ownerPairsToProcess: OwnerPairKey[] = []
  currentOwnerPairBeingProcessed: OwnerPairKey | null = null
  redistributedNodes: OrderedNodeWithPortPoints[] = []

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    for (const node of input.nodeWithPortPoints as OrderedNodeWithPortPoints[]) {
      this.mapOfNodeIdToBounds.set(
        node.capacityMeshNodeId,
        getBoundsFromNodeWithPortPoints(node),
      )
    }

    const uniqueOwnerPairs = new Map<OwnerPairKey, OwnerPair>()
    for (const node of input.nodeWithPortPoints as OrderedNodeWithPortPoints[]) {
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

    this.ownerPairsToProcess = Array.from(
      this.mapOfOwnerPairToSharedEdge.keys(),
    )
    this.ownerPairsToProcess.sort((a, b) => {
      const edgeA = this.mapOfOwnerPairToSharedEdge.get(a)!
      const edgeB = this.mapOfOwnerPairToSharedEdge.get(b)!
      return edgeA.center.x - edgeB.center.x || edgeA.center.y - edgeB.center.y
    })
  }

  private comparePortPointsForRedistribution(
    a: OrderedPortPointWithOwnerPair,
    b: OrderedPortPointWithOwnerPair,
    sharedEdge: SharedEdge,
  ) {
    const aHasTinyOrdering =
      a._tinyRouteId !== undefined || a._tinyRegionSegmentIndex !== undefined
    const bHasTinyOrdering =
      b._tinyRouteId !== undefined || b._tinyRegionSegmentIndex !== undefined

    if (aHasTinyOrdering || bHasTinyOrdering) {
      return (
        (a._tinyRouteId ?? Number.MAX_SAFE_INTEGER) -
          (b._tinyRouteId ?? Number.MAX_SAFE_INTEGER) ||
        (a._tinyRegionSegmentIndex ?? Number.MAX_SAFE_INTEGER) -
          (b._tinyRegionSegmentIndex ?? Number.MAX_SAFE_INTEGER) ||
        (a._tinySegmentEndpointIndex ?? Number.MAX_SAFE_INTEGER) -
          (b._tinySegmentEndpointIndex ?? Number.MAX_SAFE_INTEGER) ||
        a.connectionName.localeCompare(b.connectionName) ||
        (sharedEdge.orientation === "horizontal" ? a.x - b.x : a.y - b.y)
      )
    }

    return sharedEdge.orientation === "horizontal" ? a.x - b.x : a.y - b.y
  }

  private createRedistributionInput(params: {
    sharedEdge: SharedEdge
    family: OrderedPortPointWithOwnerPair[]
  }): OrderedPortPointWithOwnerPair[] {
    const { sharedEdge, family } = params
    const familyByZ = new Map<number, OrderedPortPointWithOwnerPair[]>()

    for (const portPoint of family) {
      const z = portPoint.z ?? 0
      const existing = familyByZ.get(z) ?? []
      existing.push(portPoint)
      familyByZ.set(z, existing)
    }

    const redistributionInput: OrderedPortPointWithOwnerPair[] = []

    for (const portsOnZ of familyByZ.values()) {
      const sortedPorts = [...portsOnZ].sort((a, b) =>
        this.comparePortPointsForRedistribution(a, b, sharedEdge),
      )

      for (let index = 0; index < sortedPorts.length; index++) {
        const portPoint = sortedPorts[index]!
        redistributionInput.push({
          ...portPoint,
          x: sharedEdge.orientation === "horizontal" ? index : portPoint.x,
          y: sharedEdge.orientation === "horizontal" ? portPoint.y : index,
        })
      }
    }

    return redistributionInput
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
    const family: OrderedPortPointWithOwnerPair[] = []
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
      portPoints: this.createRedistributionInput({
        sharedEdge,
        family,
      }),
    }) as OrderedPortPointWithOwnerPair[]

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
      mapOfOwnerPairToPortPoints: this.mapOfOwnerPairToPortPoints,
      mapOfOwnerPairToSharedEdge: this.mapOfOwnerPairToSharedEdge,
      ownerPairsToProcess: this.ownerPairsToProcess,
      currentOwnerPairBeingProcessed: this.currentOwnerPairBeingProcessed,
      mapOfNodeIdToBounds: this.mapOfNodeIdToBounds,
    })
  }
}

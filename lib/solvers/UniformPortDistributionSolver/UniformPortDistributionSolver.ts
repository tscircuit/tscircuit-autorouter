import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { spacePortsAroundRetainedCopper } from "./spacePortsAroundRetainedCopper"
import { BaseSolver } from "@tscircuit/solver-utils"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { GraphicsObject } from "graphics-debug"
import { Obstacle } from "lib/types"
import {
  HighDensityRoute,
  NodeWithPortPoints,
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
import {
  determineOwnerPair,
  indexPortPointOwnerNodes,
} from "./determineOwnerPair"
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
  layerCount?: number
  /** Redistribute using physical bounds and per-layer obstacles. */
  useLayerAwareGeometry?: boolean
  preserveSolitaryPorts?: boolean
  /** Copper retained by path planning whose edge-crossing order must stay fixed. */
  preloadedRoutes?: HighDensityRoute[]
  minTraceWidth?: number
  traceClearance?: number
  connMap?: ConnectivityMap
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

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
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
    const blockedOnAnotherLayer = shouldIgnoreSharedEdge({
      sharedEdge,
      obstacles: this.input.obstacles,
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
      if (
        !shouldIgnoreSharedEdge({
          sharedEdge,
          obstacles: this.input.obstacles,
          z: this.input.useLayerAwareGeometry ? portPoint.z : undefined,
          layerCount: this.input.layerCount,
        }) &&
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

    const originalById = new Map(family.map((port) => [port.portPointId, port]))
    const layersWithReversedCrossings = new Set<number>()
    for (const port of redistributed) {
      const original = originalById.get(port.portPointId)!
      if (
        layersWithReversedCrossings.has(port.z) ||
        Math.hypot(original.x - port.x, original.y - port.y) < 1e-8
      ) {
        continue
      }
      for (const route of this.input.preloadedRoutes ?? []) {
        for (let i = 1; i < route.route.length; i++) {
          const a = route.route[i - 1]!
          const b = route.route[i]!
          if (a.z !== port.z || b.z !== port.z) continue
          if (segmentToSegmentMinDistance(a, b, original, port) < 1e-8) {
            layersWithReversedCrossings.add(port.z)
            break
          }
        }
        if (layersWithReversedCrossings.has(port.z)) break
      }
    }
    // Reject only moves that cross retained copper. Unaffected layers still
    // need uniform spacing; freezing them can create unnecessary congestion.
    // Preserve the whole family on an affected layer so new ports cannot
    // reverse their order relative to each other either.
    const preferredPorts = redistributed.map((port) =>
      layersWithReversedCrossings.has(port.z)
        ? originalById.get(port.portPointId)!
        : port,
    )
    const { minTraceWidth, traceClearance, connMap, preloadedRoutes } =
      this.input
    // Legacy edges are inferred from port extents, not physical node bounds.
    // They cannot define a hard copper-clearance interval (SRJ23 sample 44).
    const spacedPorts =
      this.input.useLayerAwareGeometry &&
      minTraceWidth !== undefined &&
      traceClearance !== undefined &&
      connMap &&
      preloadedRoutes?.length
        ? spacePortsAroundRetainedCopper({
            edge: sharedEdge,
            originalPorts: familyRaw,
            preferredPorts,
            movableIds: new Set(
              familyRaw
                .filter(
                  (port) =>
                    !shouldIgnorePortPoint({
                      portPoint: port,
                      ownerNodeIds: port.ownerNodeIds,
                      inputNodes: this.input.inputNodesWithPortPoints,
                    }) &&
                    !shouldIgnoreSharedEdge({
                      sharedEdge,
                      obstacles: this.input.obstacles,
                      z: port.z,
                      layerCount: this.input.layerCount,
                    }),
                )
                .map((port) => port.portPointId!),
            ),
            routes: preloadedRoutes,
            traceWidth: minTraceWidth,
            clearance: traceClearance,
            connMap,
          })
        : preferredPorts
    this.mapOfOwnerPairToPortPoints.set(ownerPairKey, spacedPorts)
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

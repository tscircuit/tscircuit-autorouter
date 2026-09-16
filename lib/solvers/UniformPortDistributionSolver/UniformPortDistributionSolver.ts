import { BaseSolver } from "@tscircuit/solver-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import type { Obstacle, SimplifiedPcbTrace } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
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
  layerCount: number
  viaDiameter: number
  preloadedTraces: SimplifiedPcbTrace[]
  connMap: ConnectivityMap
}

interface PreloadedCopperPrimitive {
  start: { x: number; y: number }
  end: { x: number; y: number }
  width: number
  z: number
  connectedIds: string[]
}

const getPointToSegmentDistance = (
  point: { x: number; y: number },
  segment: PreloadedCopperPrimitive,
) => {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return Math.hypot(point.x - segment.start.x, point.y - segment.start.y)
  }
  const projection =
    ((point.x - segment.start.x) * dx +
      (point.y - segment.start.y) * dy) /
    lengthSquared
  const clampedProjection = Math.max(0, Math.min(1, projection))
  return Math.hypot(
    point.x - (segment.start.x + clampedProjection * dx),
    point.y - (segment.start.y + clampedProjection * dy),
  )
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
  preloadedCopperPrimitives: PreloadedCopperPrimitive[] = []

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
    for (const trace of input.preloadedTraces) {
      const connectedIds = [
        trace.pcb_trace_id,
        trace.connection_name,
        ...(trace.connectsTo ?? []),
      ]
      for (const routePoint of trace.route) {
        if (routePoint.route_type === "via") {
          const fromZ = mapLayerNameToZ(
            routePoint.from_layer,
            input.layerCount,
          )
          const toZ = mapLayerNameToZ(routePoint.to_layer, input.layerCount)
          for (let z = Math.min(fromZ, toZ); z <= Math.max(fromZ, toZ); z++) {
            this.preloadedCopperPrimitives.push({
              start: routePoint,
              end: routePoint,
              width: routePoint.via_diameter ?? input.viaDiameter,
              z,
              connectedIds,
            })
          }
          continue
        }
        if (routePoint.route_type === "through_obstacle") {
          const fromZ = mapLayerNameToZ(
            routePoint.from_layer,
            input.layerCount,
          )
          const toZ = mapLayerNameToZ(routePoint.to_layer, input.layerCount)
          for (let z = Math.min(fromZ, toZ); z <= Math.max(fromZ, toZ); z++) {
            this.preloadedCopperPrimitives.push({
              start: routePoint.start,
              end: routePoint.end,
              width: routePoint.width,
              z,
              connectedIds,
            })
          }
        }
      }
      for (let index = 1; index < trace.route.length; index++) {
        const start = trace.route[index - 1]
        const end = trace.route[index]
        if (
          start?.route_type !== "wire" ||
          end?.route_type !== "wire" ||
          start.layer !== end.layer
        ) {
          continue
        }
        this.preloadedCopperPrimitives.push({
          start,
          end,
          width: Math.max(start.width, end.width),
          z: mapLayerNameToZ(start.layer, input.layerCount),
          connectedIds,
        })
      }
    }
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

  private portPointIsConnectedToPreloadedSegment(
    portPoint: PortPointWithOwnerPair,
    segment: PreloadedCopperPrimitive,
  ): boolean {
    const portPointIds = [
      portPoint.rootConnectionName,
      portPoint.connectionName,
    ].filter((id): id is string => Boolean(id))
    return portPointIds.some((portPointId) =>
      segment.connectedIds.some(
        (connectedId) =>
          portPointId === connectedId ||
          this.input.connMap.areIdsConnected(portPointId, connectedId),
      ),
    )
  }

  private redistributionIntroducesFixedCopperCollision(
    redistributedPortPoints: PortPointWithOwnerPair[],
  ): boolean {
    const requiredPortPointClearance =
      this.input.minTraceWidth + this.input.traceClearance

    return redistributedPortPoints.some((redistributedPortPoint) => {
      const originalPortPoint = this.allPortPoints.find(
        (portPoint) =>
          portPoint.portPointId === redistributedPortPoint.portPointId,
      )
      if (!originalPortPoint) return false

      const introducesPortPointCollision = this.allPortPoints.some(
        (fixedPortPoint) => {
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
            originalDistance >= requiredPortPointClearance &&
            redistributedDistance < requiredPortPointClearance
          )
        },
      )
      if (introducesPortPointCollision) return true

      return this.preloadedCopperPrimitives.some((segment) => {
        if (
          segment.z !== (redistributedPortPoint.z ?? 0) ||
          this.portPointIsConnectedToPreloadedSegment(
            redistributedPortPoint,
            segment,
          )
        ) {
          return false
        }
        const requiredSegmentClearance =
          this.input.minTraceWidth / 2 +
          segment.width / 2 +
          this.input.traceClearance
        const originalDistance = getPointToSegmentDistance(
          originalPortPoint,
          segment,
        )
        const redistributedDistance = getPointToSegmentDistance(
          redistributedPortPoint,
          segment,
        )
        return (
          originalDistance >= requiredSegmentClearance &&
          redistributedDistance < requiredSegmentClearance
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
    const unsafeZLayers = new Set<number>()
    for (const z of new Set(redistributed.map((portPoint) => portPoint.z ?? 0))) {
      const redistributedOnLayer = redistributed.filter(
        (portPoint) => (portPoint.z ?? 0) === z,
      )
      if (
        this.redistributionIntroducesFixedCopperCollision(redistributedOnLayer)
      ) {
        unsafeZLayers.add(z)
      }
    }

    this.mapOfOwnerPairToPortPoints.set(ownerPairKey, [
      ...redistributed.filter(
        (portPoint) => !unsafeZLayers.has(portPoint.z ?? 0),
      ),
      ...familyRaw.filter((portPoint) =>
        unsafeZLayers.has(portPoint.z ?? 0),
      ),
    ])
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

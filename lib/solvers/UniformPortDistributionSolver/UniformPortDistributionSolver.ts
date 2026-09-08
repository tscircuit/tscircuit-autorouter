import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import type {
  FixedCopperClearanceIndex,
  FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
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
import { getOwnerPairKey, normalizeOwnerPair } from "./getOwnerPairKey"
import { getFixedCopperClearanceIntervals } from "./getFixedCopperClearanceIntervals"
import { getRepresentableFixedCopperClearanceChannel } from "./getRepresentableFixedCopperClearanceChannel"
import {
  placeOrderedPortsInClearanceIntervals,
  type OrderedPhysicalPort,
} from "./placeOrderedPortsInClearanceIntervals"
import { precomputeSharedEdges } from "./precomputeSharedEdges"
import { redistributePortPointsOnSharedEdge } from "./redistributePortPointsOnSharedEdge"
import { shouldIgnorePortPoint } from "./shouldIgnorePortPoint"
import { shouldIgnoreSharedEdge } from "./shouldIgnoreSharedEdge"
import { visualizeUniformPortDistribution } from "./visualizeUniformPortDistribution"

export interface UniformPortDistributionSolverInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodesWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
  physicalClearanceContext?: UniformPortPhysicalClearanceContext
}

export type UniformPortPhysicalClearanceContext = {
  readonly rectangles: readonly FixedCopperRectangle[]
  readonly traceClearanceIndex: FixedCopperClearanceIndex
  readonly layerCount: number
  readonly traceWidth: number
  readonly traceToPadClearance: number
  readonly traceToTraceClearance: number
  readonly canonicalNetIdByConnectionName: ReadonlyMap<string, string>
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
  private readonly canonicalNetIdByPortId = new Map<string, string>()
  private readonly fixedPortIds = new Set<string>()
  private readonly physicalPortWitnesses = new Map<
    string,
    { ownerPairKey: string; ownerNodeIds: OwnerPair; x: number; y: number; z: number }
  >()

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    for (const node of input.nodeWithPortPoints) {
      this.mapOfNodeIdToBounds.set(
        node.capacityMeshNodeId,
        getBoundsFromNodeWithPortPoints(node),
      )
    }

    if (input.physicalClearanceContext) {
      const referencedPortIds = new Set<string>()
      for (const node of input.nodeWithPortPoints) {
        for (const port of [
          ...node.portPoints,
          ...(node.portPointsInPairs ?? []).flat(),
        ]) {
          if (port.portPointId) referencedPortIds.add(port.portPointId)
        }
      }
      const inputOwnerPairByPortId = new Map<string, string>()
      for (const node of input.inputNodesWithPortPoints) {
        for (const port of node.portPoints) {
          if (!referencedPortIds.has(port.portPointId)) continue
          const owners = port.connectionNodeIds
          if (
            !owners || owners.length !== 2 ||
            !owners.includes(node.capacityMeshNodeId)
          ) {
            throw new Error(`Uniform input port "${port.portPointId}" has inconsistent physical ownership`)
          }
          const key = getOwnerPairKey(normalizeOwnerPair(owners[0], owners[1]))
          const previous = inputOwnerPairByPortId.get(port.portPointId)
          if (previous !== undefined && previous !== key) {
            throw new Error(`Uniform input port "${port.portPointId}" has conflicting owner pairs`)
          }
          inputOwnerPairByPortId.set(port.portPointId, key)
        }
      }
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
        if (input.physicalClearanceContext) {
          if (!ownerNodeIds.includes(node.capacityMeshNodeId)) {
            throw new Error(`Uniform port "${portPoint.portPointId}" is used outside its physical owner pair`)
          }
          const previousWitness = this.physicalPortWitnesses.get(
            portPoint.portPointId,
          )
          if (
            previousWitness &&
            (previousWitness.ownerPairKey !== ownerPairKey ||
              previousWitness.x !== portPoint.x ||
              previousWitness.y !== portPoint.y ||
              previousWitness.z !== portPoint.z)
          ) {
            throw new Error(
              `Uniform port "${portPoint.portPointId}" has inconsistent physical ownership or coordinates`,
            )
          }
          this.physicalPortWitnesses.set(portPoint.portPointId, {
            ownerPairKey,
            ownerNodeIds,
            x: portPoint.x,
            y: portPoint.y,
            z: portPoint.z,
          })
          const canonicalNetId =
            input.physicalClearanceContext.canonicalNetIdByConnectionName.get(
              portPoint.connectionName,
            )
          if (typeof canonicalNetId !== "string" || canonicalNetId.length === 0) {
            throw new Error(
              `Uniform port "${portPoint.portPointId}" has no canonical physical net for "${portPoint.connectionName}"`,
            )
          }
          const previousNetId = this.canonicalNetIdByPortId.get(
            portPoint.portPointId,
          )
          if (previousNetId !== undefined && previousNetId !== canonicalNetId) {
            throw new Error(
              `Uniform port "${portPoint.portPointId}" is shared by different physical nets`,
            )
          }
          this.canonicalNetIdByPortId.set(portPoint.portPointId, canonicalNetId)
          if (
            shouldIgnorePortPoint({
              portPoint,
              ownerNodeIds,
              inputNodes: input.inputNodesWithPortPoints,
            })
          ) {
            this.fixedPortIds.add(portPoint.portPointId)
          }
        }
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

    if (input.physicalClearanceContext) {
      for (const node of input.nodeWithPortPoints) {
        for (const port of (node.portPointsInPairs ?? []).flat()) {
          if (!port.portPointId) continue
          const witness = this.physicalPortWitnesses.get(port.portPointId)
          const netId = input.physicalClearanceContext
            .canonicalNetIdByConnectionName.get(port.connectionName)
          if (
            !witness ||
            !witness.ownerNodeIds.includes(node.capacityMeshNodeId) ||
            witness.x !== port.x || witness.y !== port.y || witness.z !== port.z ||
            netId === undefined ||
            netId !== this.canonicalNetIdByPortId.get(port.portPointId)
          ) {
            throw new Error(`Uniform pair port "${port.portPointId}" has inconsistent physical ownership, coordinates or net`)
          }
        }
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

    if (this.input.physicalClearanceContext) {
      const constrainedEdge = this.getFixedPadConstrainedSharedEdge(sharedEdge)
      if (constrainedEdge) {
        this.redistributePhysicallyClearPorts(constrainedEdge)
        return
      }
    }

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

    this.mapOfOwnerPairToPortPoints.set(ownerPairKey, redistributed)
  }

  private getFixedPadConstrainedSharedEdge(
    sharedEdgeBounds: SharedEdge,
  ): SharedEdge | null {
    const context = this.input.physicalClearanceContext
    if (!context) {
      throw new Error("Uniform physical edge classification requires its copper context")
    }
    const family = this.mapOfOwnerPairToPortPoints.get(sharedEdgeBounds.ownerPairKey)
    if (!family || family.length === 0) {
      throw new Error(`Uniform edge "${sharedEdgeBounds.ownerPairKey}" has no port family`)
    }
    const horizontal = sharedEdgeBounds.orientation === "horizontal"
    const fixedCoordinate = horizontal ? family[0].y : family[0].x
    for (const port of family) {
      if ((horizontal ? port.y : port.x) !== fixedCoordinate) {
        throw new Error(`Uniform edge "${sharedEdgeBounds.ownerPairKey}" has inconsistent physical port coordinates`)
      }
    }
    // Shared-port generation uses the overlap midpoint, which can differ from
    // either owner's boundary. Preserve that physical coordinate without
    // changing the along-edge intersection of the two owner extents.
    const sharedEdge: SharedEdge = {
      ...sharedEdgeBounds,
      x1: horizontal ? sharedEdgeBounds.x1 : fixedCoordinate,
      x2: horizontal ? sharedEdgeBounds.x2 : fixedCoordinate,
      y1: horizontal ? fixedCoordinate : sharedEdgeBounds.y1,
      y2: horizontal ? fixedCoordinate : sharedEdgeBounds.y2,
      center: {
        x: horizontal ? sharedEdgeBounds.center.x : fixedCoordinate,
        y: horizontal ? fixedCoordinate : sharedEdgeBounds.center.y,
      },
    }
    for (const port of family) {
      if (!port.portPointId) {
        throw new Error(`Uniform edge "${sharedEdge.ownerPairKey}" has an unnamed physical port`)
      }
      const canonicalNetId = this.canonicalNetIdByPortId.get(port.portPointId)
      if (!canonicalNetId) {
        throw new Error(`Uniform port "${port.portPointId}" has no physical net`)
      }
      // Classify the input domain before placement. The legacy branch can
      // use a slightly different owner boundary, so both full segments must
      // be clear before retaining that branch's exact existing behavior.
      for (const edge of [sharedEdge, sharedEdgeBounds]) {
        if (!context.traceClearanceIndex.isSegmentClear({
          start: { x: edge.x1, y: edge.y1, z: port.z },
          end: { x: edge.x2, y: edge.y2, z: port.z },
          canonicalNetId,
          copperDiameter: context.traceWidth,
        })) {
          return sharedEdge
        }
      }
    }
    return null
  }

  private redistributePhysicallyClearPorts(sharedEdge: SharedEdge): void {
    const context = this.input.physicalClearanceContext
    if (!context) {
      throw new Error("Uniform physical redistribution requires its copper context")
    }
    const family = this.mapOfOwnerPairToPortPoints.get(sharedEdge.ownerPairKey)
    if (!family || family.length === 0) {
      throw new Error(`Uniform edge "${sharedEdge.ownerPairKey}" has no port family`)
    }
    const fixedEdge = shouldIgnoreSharedEdge({
      sharedEdge,
      obstacles: this.input.obstacles,
    })
    const portsByZ = new Map<number, PortPointWithOwnerPair[]>()
    for (const portPoint of family) {
      const portsOnZ = portsByZ.get(portPoint.z)
      if (portsOnZ) portsOnZ.push(portPoint)
      else portsByZ.set(portPoint.z, [portPoint])
    }
    const redistributed: PortPointWithOwnerPair[] = []
    for (const z of [...portsByZ.keys()].sort((a, b): number => a - b)) {
      const ports = portsByZ.get(z)!
      ports.sort((a, b): number =>
        sharedEdge.orientation === "horizontal" ? a.x - b.x : a.y - b.y,
      )
      const axisStart = sharedEdge.orientation === "horizontal"
        ? sharedEdge.x1
        : sharedEdge.y1
      const axisEnd = sharedEdge.orientation === "horizontal"
        ? sharedEdge.x2
        : sharedEdge.y2
      const placementPorts = ports.map((port, index): OrderedPhysicalPort => {
        if (!port.portPointId) {
          throw new Error(`Uniform edge "${sharedEdge.ownerPairKey}" has an unnamed physical port`)
        }
        const canonicalNetId = this.canonicalNetIdByPortId.get(port.portPointId)
        if (!canonicalNetId) {
          throw new Error(`Uniform port "${port.portPointId}" has no physical net`)
        }
        const selected = sharedEdge.orientation === "horizontal"
          ? port.x
          : port.y
        const onEdge = sharedEdge.orientation === "horizontal"
          ? port.y === sharedEdge.y1
          : port.x === sharedEdge.x1
        if (!onEdge || selected < axisStart || selected > axisEnd) {
          throw new Error(`Uniform port "${port.portPointId}" is outside its physical edge`)
        }
        const intervals = getFixedCopperClearanceIntervals({
          start: { x: sharedEdge.x1, y: sharedEdge.y1 },
          end: { x: sharedEdge.x2, y: sharedEdge.y2 },
          z,
          layerCount: context.layerCount,
          canonicalNetId,
          copperDiameter: context.traceWidth,
          minClearance: context.traceToPadClearance,
          rectangles: context.rectangles,
        }).map((interval): { start: number; end: number } => ({
          start: axisStart + interval.start,
          end: axisStart + interval.end,
        }))
        const selectedChannel = intervals.find(
          (interval): boolean => selected >= interval.start && selected <= interval.end,
        )
        if (
          !selectedChannel ||
          !context.traceClearanceIndex.isPointClear({
            point: port,
            canonicalNetId,
            copperDiameter: context.traceWidth,
          })
        ) {
          throw new Error(`Uniform port "${port.portPointId}" was selected inside forbidden fixed copper clearance`)
        }
        const fixed = fixedEdge || this.fixedPortIds.has(port.portPointId)
        const representableChannel = getRepresentableFixedCopperClearanceChannel({
          interval: selectedChannel,
          axis: sharedEdge.orientation === "horizontal" ? "x" : "y",
          fixedCoordinate: sharedEdge.orientation === "horizontal"
            ? sharedEdge.y1
            : sharedEdge.x1,
          z,
          selectedCoordinate: selected,
          canonicalNetId,
          copperDiameter: context.traceWidth,
          clearanceIndex: context.traceClearanceIndex,
        })
        return {
          allowedIntervals: fixed
            ? [{ start: selected, end: selected }]
            : [representableChannel],
          uniformTarget:
            axisStart + sharedEdge.length * (2 * index + 1) / (2 * ports.length),
          canonicalNetId,
          copperDiameter: context.traceWidth,
        }
      })
      const positions = placeOrderedPortsInClearanceIntervals({
        ports: placementPorts,
        traceGap: context.traceToTraceClearance,
      })
      for (const [index, port] of ports.entries()) {
        const updated = {
          ...port,
          x: sharedEdge.orientation === "horizontal"
            ? positions[index]!
            : sharedEdge.x1,
          y: sharedEdge.orientation === "horizontal"
            ? sharedEdge.y1
            : positions[index]!,
        }
        if (!context.traceClearanceIndex.isPointClear({
          point: updated,
          canonicalNetId: placementPorts[index]!.canonicalNetId,
          copperDiameter: context.traceWidth,
        })) {
          throw new Error(`Uniform port "${port.portPointId}" has unrepresentable fixed copper clearance after placement`)
        }
        redistributed.push(updated)
      }
    }
    this.mapOfOwnerPairToPortPoints.set(sharedEdge.ownerPairKey, redistributed)
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

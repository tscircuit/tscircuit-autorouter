import { BaseSolver } from "@tscircuit/solver-utils"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { Obstacle, type SimpleRouteJson } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  compileTraceClearanceObstacle,
  getTraceObstacleClearance,
  type IndexedObstacle,
} from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"
import { createPcbPadElements } from "lib/utils/convertToCircuitJson"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
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
  minTraceWidth?: number
  srj?: SimpleRouteJson
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
  private readonly crampedPortIds = new Set<string>()
  private readonly clearanceObstacles: IndexedObstacle[]

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    for (const node of input.inputNodesWithPortPoints) {
      for (const point of node.portPoints) {
        if (point.cramped) this.crampedPortIds.add(point.portPointId)
      }
    }
    this.clearanceObstacles = input.srj && !input.srj.traces?.length
      ? createPcbPadElements(input.srj)
          .filter(
            (element): element is IndexedObstacle["element"] =>
              element.type === "pcb_smtpad" ||
              element.type === "pcb_plated_hole" ||
              element.type === "pcb_hole",
          )
          .map(compileTraceClearanceObstacle)
      : []
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

    this.mapOfOwnerPairToPortPoints.set(
      ownerPairKey,
      redistributed.map((point) =>
        portCountByLayer.get(point.z) === 1 &&
        this.crampedPortIds.has(point.portPointId!)
          ? this.placeCrampedPort(sharedEdge, point)
          : point,
      ),
    )
  }

  private placeCrampedPort(
    edge: SharedEdge,
    point: PortPointWithOwnerPair,
  ): PortPointWithOwnerPair {
    const { srj, minTraceWidth, connMap } = this.input
    if (!srj || srj.traces?.length || minTraceWidth === undefined) return point
    const root = point.rootConnectionName ?? point.connectionName
    const net =
      connMap?.getNetConnectedToId(point.connectionName) ??
      connMap?.getNetConnectedToId(root) ??
      root
    const layer = mapZToLayerName(point.z, srj.layerCount)
    const obstacles = this.clearanceObstacles.filter((obstacle) => {
      if (!obstacle.layers.includes(layer)) return false
      const portId =
        "pcb_port_id" in obstacle.element
          ? obstacle.element.pcb_port_id
          : undefined
      return ![obstacle.id, portId].some(
        (id) =>
          typeof id === "string" &&
          (id === point.connectionName ||
            id === root ||
            connMap?.getNetConnectedToId(id) === net),
      )
    })
    const padClearance =
      srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0.1
    const requiredClearance = (obstacle: IndexedObstacle): number => {
      if (obstacle.element.type === "pcb_hole") {
        return srj.minTraceToHoleEdgeClearance ?? 0.2
      }
      return padClearance
    }
    if (
      !obstacles.some(
        (obstacle) =>
          obstacle.shape.kind === "circle" &&
          obstacle.element.type !== "pcb_hole" &&
          getTraceObstacleClearance(point, point, minTraceWidth, obstacle).gap <
            requiredClearance(obstacle),
      )
    ) {
      return point
    }

    const vertical = edge.orientation === "vertical"
    let intervals: Array<[number, number]> = [
      vertical ? [edge.y1, edge.y2] : [edge.x1, edge.x2],
    ]
    for (const obstacle of obstacles) {
      if (obstacle.shape.kind !== "circle") continue
      const { center, radius } = obstacle.shape
      const reach = radius + minTraceWidth / 2 + requiredClearance(obstacle)
      const offset = vertical ? edge.x1 - center.x : edge.y1 - center.y
      if (Math.abs(offset) >= reach) continue
      const extent = Math.sqrt(reach * reach - offset * offset)
      const middle = vertical ? center.y : center.x
      const low = middle - extent
      const high = middle + extent
      intervals = intervals.flatMap(([start, end]): Array<[number, number]> => {
        if (high <= start || low >= end) return [[start, end]]
        const remaining: Array<[number, number]> = []
        if (low > start) remaining.push([start, low])
        if (high < end) remaining.push([high, end])
        return remaining
      })
    }
    const longest = intervals.sort(
      (a, b) => b[1] - b[0] - (a[1] - a[0]),
    )[0]
    if (!longest) return point
    const middle = (longest[0] + longest[1]) / 2
    const candidate = {
      ...point,
      x: vertical ? edge.x1 : middle,
      y: vertical ? middle : edge.y1,
    }
    if (
      !obstacles.every(
        (obstacle) =>
          getTraceObstacleClearance(
            candidate, candidate, minTraceWidth, obstacle,
          ).gap >= requiredClearance(obstacle),
      )
    ) {
      return point
    }
    const fixedViolations = getFixedObstacleViolations({
      srj: {
        ...srj,
        traces: undefined,
        connections: [
          ...srj.connections,
          {
            name: point.connectionName,
            rootConnectionName: root,
            __rootConnectionNames: connMap?.netMap[net],
            pointsToConnect: [],
          },
        ],
      },
      traceClearance: padClearance,
      routes: [
        {
          connectionName: point.connectionName,
          rootConnectionName: root,
          traceThickness: minTraceWidth,
          viaDiameter: srj.minViaPadDiameter ?? srj.minViaDiameter ?? 0.3,
          route: [candidate, candidate],
          vias: [],
        },
      ],
    })
    return fixedViolations.length === 0 ? candidate : point
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

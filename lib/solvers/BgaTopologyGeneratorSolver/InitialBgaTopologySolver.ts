import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { TopologyGeneratorSolverOutput } from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BgaGrid } from "./bga-grid"
import type { BgaGap, MissingBgaSlot } from "./bga-grid"
import { getObstacleTargetConnectionNames } from "./getObstacleTargetConnectionNames"

export const BGA_MULTILAYER_REGION_VIA_DIAMETER_FACTOR = 1.2
const BGA_DIMENSION_EPSILON = 1e-6

export type InitialBgaTopologySolverInput = {
  srj: SimpleRouteJson
  componentBounds: SimpleRouteJson["bounds"]
  componentId: string
  markedComponentObstacles: Obstacle[]
  unmarkedComponentObstacles: Obstacle[]
  viaDiameter?: number
}

function getStableObstacleNodeToken(obstacle: Obstacle): string {
  return (
    obstacle.obstacleId ??
    [
      obstacle.componentId ?? "no-component",
      obstacle.center.x,
      obstacle.center.y,
      obstacle.width,
      obstacle.height,
      obstacle.layers.join(","),
    ].join(":")
  )
}

function ensureUniqueMeshNodeIds(
  meshNodes: CapacityMeshNode[],
): CapacityMeshNode[] {
  const seenNodeIds = new Map<string, number>()

  return meshNodes.map((meshNode) => {
    const seenCount = seenNodeIds.get(meshNode.capacityMeshNodeId) ?? 0
    seenNodeIds.set(meshNode.capacityMeshNodeId, seenCount + 1)

    if (seenCount === 0) return meshNode

    return {
      ...meshNode,
      capacityMeshNodeId: `${meshNode.capacityMeshNodeId}__dup${seenCount}`,
    }
  })
}

function getStableGapNodeToken({
  componentId,
  orientationKey,
  row,
  col,
  center,
  width,
  height,
}: {
  componentId: string
  orientationKey: string
  row: number
  col: number
  center: { x: number; y: number }
  width: number
  height: number
}) {
  return [
    "cmn",
    orientationKey,
    componentId,
    row,
    col,
    center.x,
    center.y,
    width,
    height,
  ].join("_")
}

function createMeshNodesFromBgaGap(input: {
  componentId: string
  bgaGap: BgaGap
  freeLayers: number[]
  multiLayerThreshold: number
}): CapacityMeshNode[] {
  const { componentId, bgaGap, freeLayers, multiLayerThreshold } = input
  const isLargeEnoughForMultiLayer =
    bgaGap.width >= multiLayerThreshold - BGA_DIMENSION_EPSILON &&
    bgaGap.height >= multiLayerThreshold - BGA_DIMENSION_EPSILON
  let orientationKey: string = "d"
  if (bgaGap.orientation === "horizontal") orientationKey = "h"
  if (bgaGap.orientation === "vertical") orientationKey = "v"
  const baseNodeId: string = getStableGapNodeToken({
    componentId,
    orientationKey,
    row: bgaGap.row,
    col: bgaGap.col,
    center: bgaGap.center,
    width: bgaGap.width,
    height: bgaGap.height,
  })

  if (bgaGap.orientation === "diagonal" && isLargeEnoughForMultiLayer) {
    return [
      {
        center: bgaGap.center,
        width: bgaGap.width,
        height: bgaGap.height,
        availableZ: [...freeLayers],
        capacityMeshNodeId: `${baseNodeId}_all`,
        layer: "",
      },
    ]
  }

  if (!bgaGap.isBetweenTwoPads && isLargeEnoughForMultiLayer) {
    return [
      {
        center: bgaGap.center,
        width: bgaGap.width,
        height: bgaGap.height,
        availableZ: [...freeLayers],
        capacityMeshNodeId: `${baseNodeId}_all`,
        layer: "",
      },
    ]
  }

  return freeLayers.map((z) => ({
    center: bgaGap.center,
    width: bgaGap.width,
    height: bgaGap.height,
    availableZ: [z],
    capacityMeshNodeId: `${baseNodeId}_${z}`,
    layer: "",
  }))
}

function createMeshNodeFromMissingBgaSlot(input: {
  componentId: string
  missingBgaSlot: MissingBgaSlot
  freeLayers: number[]
  multiLayerThreshold: number
}): CapacityMeshNode[] {
  const { componentId, missingBgaSlot, freeLayers, multiLayerThreshold } = input
  const baseNodeId = getStableGapNodeToken({
    componentId,
    orientationKey: "missing",
    row: missingBgaSlot.row,
    col: missingBgaSlot.col,
    center: missingBgaSlot.center,
    width: missingBgaSlot.width,
    height: missingBgaSlot.height,
  })
  const isLargeEnoughForMultiLayer =
    missingBgaSlot.width >= multiLayerThreshold - BGA_DIMENSION_EPSILON &&
    missingBgaSlot.height >= multiLayerThreshold - BGA_DIMENSION_EPSILON

  if (!isLargeEnoughForMultiLayer) {
    return freeLayers.map((z) => ({
      center: missingBgaSlot.center,
      width: missingBgaSlot.width,
      height: missingBgaSlot.height,
      availableZ: [z],
      capacityMeshNodeId: `${baseNodeId}_${z}`,
      layer: "",
    }))
  }

  return [
    {
      center: missingBgaSlot.center,
      width: missingBgaSlot.width,
      height: missingBgaSlot.height,
      availableZ: [...freeLayers],
      capacityMeshNodeId: `${baseNodeId}_all`,
      layer: "",
    },
  ]
}

function createFreeObstacleMeshNodes(input: {
  componentId: string
  obstacle: Obstacle
  freeLayers: number[]
  layerCount: number
}): CapacityMeshNode[] {
  const { componentId, obstacle, freeLayers, layerCount } = input
  const obstacleLayers: number[] = obstacle.layers.map((layerName) =>
    mapLayerNameToZ(layerName, layerCount),
  )
  const obstacleFreeLayers: number[] = freeLayers.filter(
    (layer) => !obstacleLayers.includes(layer),
  )
  const obstacleNodeToken = getStableObstacleNodeToken(obstacle)

  return obstacleFreeLayers.map((layer) => ({
    capacityMeshNodeId: `free-${componentId}-${obstacleNodeToken}-${layer}`,
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    layer: `z${layer}`,
    availableZ: [layer],
  }))
}

function createObstacleMeshNode(
  componentId: string,
  obstacle: Obstacle,
  srj: SimpleRouteJson,
): CapacityMeshNode {
  const obstacleLayers: number[] = obstacle.layers.map((layerName) =>
    mapLayerNameToZ(layerName, srj.layerCount),
  )
  const obstacleNodeToken = getStableObstacleNodeToken(obstacle)
  const targetConnectionNames = getObstacleTargetConnectionNames({
    obstacle,
    srj,
  })
  const targetConnectionName = targetConnectionNames[0]

  return {
    capacityMeshNodeId: `obstacle-${componentId}-${obstacleNodeToken}-${obstacleLayers.join(",")}-${obstacle.center.x}-${obstacle.center.y}`,
    _containsObstacle: true,
    ...(targetConnectionName
      ? {
          _containsTarget: true,
          _targetConnectionName: targetConnectionName,
          _connectedTo: targetConnectionNames,
        }
      : {}),
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    layer: `z${obstacleLayers.join(",")}`,
    availableZ: obstacleLayers,
  }
}

export class InitialBgaTopologySolver extends BaseSolver {
  componentObstacles: Obstacle[] = []
  meshNodes: CapacityMeshNode[] = []

  constructor(public readonly inputProblem: InitialBgaTopologySolverInput) {
    super()
  }

  getConstructorParams(): readonly [InitialBgaTopologySolverInput] {
    return [this.inputProblem] as const
  }

  override _step(): void {
    const {
      srj,
      componentBounds,
      componentId,
      markedComponentObstacles,
      unmarkedComponentObstacles,
    } = this.inputProblem

    const copperPoursInBounds: Obstacle[] = srj.obstacles
      .filter((obstacle) => obstacle.isCopperPour === true)
      .filter((obstacle) =>
        doBoundsOverlap(getBoundFromCenteredRect(obstacle), componentBounds),
      )

    const blockedLayers: number[] = copperPoursInBounds.flatMap((obstacle) =>
      obstacle.layers.map((layerName) =>
        mapLayerNameToZ(layerName, srj.layerCount),
      ),
    )

    const freeLayers: number[] = Array.from(
      { length: srj.layerCount },
      (_, layerIndex) => layerIndex,
    ).filter((layer) => !blockedLayers.includes(layer))

    this.componentObstacles = markedComponentObstacles

    if (markedComponentObstacles.length === 0 || freeLayers.length === 0) {
      this.solved = true
      return
    }

    const bgaGrid: BgaGrid | null = BgaGrid.fromObstacles(
      markedComponentObstacles,
    )

    if (!bgaGrid) {
      this.solved = true
      return
    }

    const axisGaps: BgaGap[] = bgaGrid.getAxisGaps()
    const diagonalGaps: BgaGap[] = bgaGrid.getDiagonalGaps()
    const missingBgaSlots: MissingBgaSlot[] = bgaGrid.getMissingSlots()
    const viaDiameter =
      this.inputProblem.viaDiameter ?? getViaDimensions(srj).padDiameter
    const multiLayerThreshold =
      viaDiameter * BGA_MULTILAYER_REGION_VIA_DIAMETER_FACTOR
    this.meshNodes = [
      ...axisGaps.flatMap((bgaGap) =>
        createMeshNodesFromBgaGap({
          componentId,
          bgaGap,
          freeLayers,
          multiLayerThreshold,
        }),
      ),
      ...diagonalGaps.flatMap((bgaGap) =>
        createMeshNodesFromBgaGap({
          componentId,
          bgaGap,
          freeLayers,
          multiLayerThreshold,
        }),
      ),
      ...missingBgaSlots.flatMap((missingBgaSlot) =>
        createMeshNodeFromMissingBgaSlot({
          componentId,
          missingBgaSlot,
          freeLayers,
          multiLayerThreshold,
        }),
      ),
      ...markedComponentObstacles.flatMap((obstacle) => [
        ...createFreeObstacleMeshNodes({
          componentId,
          obstacle,
          freeLayers,
          layerCount: srj.layerCount,
        }),
        createObstacleMeshNode(componentId, obstacle, srj),
      ]),
      ...unmarkedComponentObstacles.flatMap((obstacle) => [
        // skip for unmarked becase we already have free layers available
        // this will cause overlaps srj18 013 is an good exmpale
        // ...createFreeObstacleMeshNodes({
        //   componentId,
        //   obstacle,
        //   freeLayers,
        //   layerCount: srj.layerCount,
        // }),
        createObstacleMeshNode(componentId, obstacle, srj),
      ]),
    ]
    this.meshNodes = ensureUniqueMeshNodeIds(this.meshNodes)

    this.solved = true
  }

  getOutput(): CapacityMeshNode[] {
    return this.meshNodes
  }

  override visualize(): GraphicsObject {
    return {
      rects: [
        {
          center: {
            x:
              (this.inputProblem.componentBounds.minX +
                this.inputProblem.componentBounds.maxX) /
              2,
            y:
              (this.inputProblem.componentBounds.minY +
                this.inputProblem.componentBounds.maxY) /
              2,
          },
          width:
            this.inputProblem.componentBounds.maxX -
            this.inputProblem.componentBounds.minX,
          height:
            this.inputProblem.componentBounds.maxY -
            this.inputProblem.componentBounds.minY,
          fill: "rgba(0,0,0,0)",
          stroke: "rgba(30,30,30,0.65)",
          label: `component ${this.inputProblem.componentId}`,
        },
        ...this.inputProblem.markedComponentObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(255,0,0,0.18)",
          stroke: "rgba(255,0,0,0.52)",
          label: `pad ${obstacle.obstacleId ?? "obstacle"}`,
        })),
        ...this.inputProblem.unmarkedComponentObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(255,140,0,0.14)",
          stroke: "rgba(255,140,0,0.42)",
          label: `foreign ${obstacle.obstacleId ?? "obstacle"}`,
        })),
        ...this.meshNodes.map((node) => ({
          ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
          fill: node._containsObstacle
            ? "rgba(255,0,0,0.14)"
            : node.capacityMeshNodeId.includes("missing")
              ? "rgba(0,200,120,0.18)"
              : "rgba(0,120,255,0.12)",
          stroke: node._containsObstacle
            ? "rgba(255,0,0,0.36)"
            : node.capacityMeshNodeId.includes("missing")
              ? "rgba(0,200,120,0.52)"
              : "rgba(0,120,255,0.38)",
        })),
      ],
    }
  }
}

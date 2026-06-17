import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { TopologyGeneratorSolverOutput } from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BgaGrid } from "./bga-grid"
import type { BgaGap, MissingBgaSlot } from "./bga-grid"

export type InitialBgaTopologySolverInput = {
  srj: SimpleRouteJson
  componentBounds: SimpleRouteJson["bounds"]
  componentId: string
  markedComponentObstacles: Obstacle[]
  unmarkedComponentObstacles: Obstacle[]
}

function createMeshNodesFromBgaGap(input: {
  componentId: string
  bgaGap: BgaGap
  freeLayers: number[]
}): CapacityMeshNode[] {
  const { componentId, bgaGap, freeLayers } = input
  let orientationKey: string = "d"
  if (bgaGap.orientation === "horizontal") orientationKey = "h"
  if (bgaGap.orientation === "vertical") orientationKey = "v"
  const baseNodeId: string = `cmn_${orientationKey}_${componentId}_${bgaGap.row}_${bgaGap.col}`

  if (bgaGap.orientation === "diagonal") {
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

  if (!bgaGap.isBetweenTwoPads) {
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
}): CapacityMeshNode {
  const { componentId, missingBgaSlot, freeLayers } = input

  return {
    center: missingBgaSlot.center,
    width: missingBgaSlot.width,
    height: missingBgaSlot.height,
    availableZ: [...freeLayers],
    capacityMeshNodeId: `cmn_missing_${componentId}_${missingBgaSlot.row}_${missingBgaSlot.col}_all`,
    layer: "",
  }
}

function createFreeObstacleMeshNodes(input: {
  obstacle: Obstacle
  freeLayers: number[]
  layerCount: number
}): CapacityMeshNode[] {
  const { obstacle, freeLayers, layerCount } = input
  const obstacleLayers: number[] = obstacle.layers.map((layerName) =>
    mapLayerNameToZ(layerName, layerCount),
  )
  const obstacleFreeLayers: number[] = freeLayers.filter(
    (layer) => !obstacleLayers.includes(layer),
  )

  return obstacleFreeLayers.map((layer) => ({
    capacityMeshNodeId: `free-${obstacle.obstacleId}-${layer}`,
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    layer: `z${layer}`,
    availableZ: [layer],
  }))
}

function createObstacleMeshNode(
  obstacle: Obstacle,
  layerCount: number,
): CapacityMeshNode {
  const obstacleLayers: number[] = obstacle.layers.map((layerName) =>
    mapLayerNameToZ(layerName, layerCount),
  )

  return {
    capacityMeshNodeId: `obstacle-${obstacle.obstacleId}-${obstacleLayers.join(",")}-${obstacle.center.x}-${obstacle.center.y}`,
    _containsObstacle: true,
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
    this.meshNodes = [
      ...axisGaps.flatMap((bgaGap) =>
        createMeshNodesFromBgaGap({
          componentId,
          bgaGap,
          freeLayers,
        }),
      ),
      ...diagonalGaps.flatMap((bgaGap) =>
        createMeshNodesFromBgaGap({
          componentId,
          bgaGap,
          freeLayers,
        }),
      ),
      ...missingBgaSlots.map((missingBgaSlot) =>
        createMeshNodeFromMissingBgaSlot({
          componentId,
          missingBgaSlot,
          freeLayers,
        }),
      ),
      ...markedComponentObstacles.flatMap((obstacle) => [
        ...createFreeObstacleMeshNodes({
          obstacle,
          freeLayers,
          layerCount: srj.layerCount,
        }),
        createObstacleMeshNode(obstacle, srj.layerCount),
      ]),
      ...unmarkedComponentObstacles.flatMap((obstacle) => [
        // skip for unmarked becase we already have free layers available
        // this will cause overlaps srj18 013 is an good exmpale
        // ...createFreeObstacleMeshNodes({
        //   obstacle,
        //   freeLayers,
        //   layerCount: srj.layerCount,
        // }),
        createObstacleMeshNode(obstacle, srj.layerCount),
      ]),
    ]

    this.solved = true
  }

  getOutput(): TopologyGeneratorSolverOutput {
    return {
      routingRegions: this.meshNodes,
    }
  }
}

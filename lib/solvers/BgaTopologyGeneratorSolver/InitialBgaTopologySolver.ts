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
}

function createMeshNodesFromBgaGap(params: {
  componentId: string
  bgaGap: BgaGap
  freeLayers: number[]
}): CapacityMeshNode[] {
  const { componentId, bgaGap, freeLayers } = params
  let orientationKey = "d"
  if (bgaGap.orientation === "horizontal") orientationKey = "h"
  if (bgaGap.orientation === "vertical") orientationKey = "v"
  const baseNodeId = `cmn_${orientationKey}_${componentId}_${bgaGap.row}_${bgaGap.col}`

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

function createMeshNodeFromMissingBgaSlot(params: {
  componentId: string
  missingBgaSlot: MissingBgaSlot
  freeLayers: number[]
}): CapacityMeshNode {
  const { componentId, missingBgaSlot, freeLayers } = params

  return {
    center: missingBgaSlot.center,
    width: missingBgaSlot.width,
    height: missingBgaSlot.height,
    availableZ: [...freeLayers],
    capacityMeshNodeId: `cmn_missing_${componentId}_${missingBgaSlot.row}_${missingBgaSlot.col}_all`,
    layer: "",
  }
}

export class InitialBgaTopologySolver extends BaseSolver {
  componentObstacles: Obstacle[] = []
  freeMeshNodes: CapacityMeshNode[] = []

  constructor(public readonly inputProblem: InitialBgaTopologySolverInput) {
    super()
  }

  getConstructorParams(): readonly [InitialBgaTopologySolverInput] {
    return [this.inputProblem] as const
  }

  step(): void {
    const { srj, componentBounds, componentId } = this.inputProblem

    const componentObstacles = srj.obstacles.filter((obstacle) => {
      return (
        doBoundsOverlap(getBoundFromCenteredRect(obstacle), componentBounds) &&
        obstacle.componentId === componentId
      )
    })

    const copperPoursInBounds = srj.obstacles
      .filter((obstacle) => obstacle.isCopperPour === true)
      .filter((obstacle) =>
        doBoundsOverlap(getBoundFromCenteredRect(obstacle), componentBounds),
      )

    const blockedLayers = copperPoursInBounds.flatMap((obstacle) =>
      obstacle.layers.map(mapLayerNameToZ),
    )

    const freeLayers = Array.from(
      { length: srj.layerCount },
      (_, layerIndex) => layerIndex,
    ).filter((layer) => !blockedLayers.includes(layer))

    this.componentObstacles = componentObstacles

    if (componentObstacles.length === 0 || freeLayers.length === 0) {
      this.solved = true
      return
    }

    const bgaGrid = BgaGrid.fromObstacles(componentObstacles)

    if (!bgaGrid) {
      this.solved = true
      return
    }

    const axisGaps = bgaGrid.getAxisGaps()
    const diagonalGaps = bgaGrid.getDiagonalGaps()
    const missingBgaSlots = bgaGrid.getMissingSlots()

    this.freeMeshNodes = [
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
    ]

    this.solved = true
  }

  getOutput(): TopologyGeneratorSolverOutput {
    return {
      routingRegions: this.freeMeshNodes,
    }
  }
}

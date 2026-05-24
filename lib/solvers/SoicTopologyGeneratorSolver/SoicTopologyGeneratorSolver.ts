import { getBoundingBox } from "@tscircuit/math-utils"
import type { Bounds } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import {
  clusterAxisValues,
  getLayerRange,
} from "lib/solvers/BgaTopologyGeneratorSolver/bgpTopologyGeneratorShared"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

const MIN_REGION_SIDE = 1e-6

type SoicOrientation = "vertical-columns" | "horizontal-rows"

type SoicSide = "left" | "right" | "top" | "bottom"

type RectRegion = {
  center: { x: number; y: number }
  width: number
  height: number
}

type SoicRoutingRegion = {
  key: string
  bounds: Bounds
  regionType: "center" | "pad" | "pad-gap"
  containsObstacle?: boolean
}

export interface SoicTopologyGeneratorSolverParams {
  inputSrj: SimpleRouteJson
  componentId?: string
  replacementObstacleId?: string
  viaDiameter?: number
  obstacleMargin?: number
}

export interface SoicTopologyGeneratorSolverOutput {
  /** Exact obstacle rectangles cloned from the input SRJ. This is the geometry source of truth. */
  obstacles: Obstacle[]
  /** Routing regions derived from the SOIC pad rows/columns. These are not obstacle rectangles. */
  routingRegions: CapacityMeshNode[]
}

function createRectRegion(bounds: Bounds): RectRegion {
  return {
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  }
}

function isValidBounds(bounds: Bounds) {
  return (
    bounds.maxX - bounds.minX > MIN_REGION_SIDE &&
    bounds.maxY - bounds.minY > MIN_REGION_SIDE
  )
}

function createMeshNodesForRegion({
  nodeId,
  bounds,
  availableZ,
  multiLayerThreshold,
  regionType,
  containsObstacle = false,
}: {
  nodeId: string
  bounds: Bounds
  availableZ: number[]
  multiLayerThreshold: number
  regionType: SoicRoutingRegion["regionType"]
  containsObstacle?: boolean
}): CapacityMeshNode[] {
  if (!isValidBounds(bounds)) return []

  const region = createRectRegion(bounds)
  const isLargeEnoughForMultiZ =
    Math.min(region.width, region.height) > multiLayerThreshold

  if (isLargeEnoughForMultiZ) {
    return [
      {
        capacityMeshNodeId: nodeId,
        center: region.center,
        width: region.width,
        height: region.height,
        layer: `z${availableZ.join(",")}`,
        availableZ: [...availableZ],
        _soicRegionType: regionType,
        _containsObstacle: containsObstacle,
      },
    ]
  }

  return availableZ.map((z) => ({
    capacityMeshNodeId: `${nodeId}:z${z}`,
    center: region.center,
    width: region.width,
    height: region.height,
    layer: `z${z}`,
    availableZ: [z],
    _soicRegionType: regionType,
    _containsObstacle: containsObstacle,
  }))
}

function getNearestClusterIndex(value: number, clusters: number[]) {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < clusters.length; index++) {
    const distance = Math.abs(value - clusters[index]!)
    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }

  return nearestIndex
}

function getSoicOrientation(obstacles: Obstacle[]): SoicOrientation {
  const rowCount = clusterAxisValues(
    obstacles.map((obstacle) => obstacle.center.y),
  ).length
  const columnCount = clusterAxisValues(
    obstacles.map((obstacle) => obstacle.center.x),
  ).length

  return columnCount === 2 && rowCount !== 2
    ? "vertical-columns"
    : "horizontal-rows"
}

function groupSoicPads({
  obstacles,
  orientation,
}: {
  obstacles: Obstacle[]
  orientation: SoicOrientation
}) {
  const sideGroups: Record<SoicSide, Obstacle[]> = {
    left: [],
    right: [],
    top: [],
    bottom: [],
  }

  if (orientation === "vertical-columns") {
    const xClusters = clusterAxisValues(
      obstacles.map((obstacle) => obstacle.center.x),
    )

    for (const obstacle of obstacles) {
      const clusterIndex = getNearestClusterIndex(obstacle.center.x, xClusters)
      sideGroups[clusterIndex === 0 ? "left" : "right"].push(obstacle)
    }

    sideGroups.left.sort((a, b) => a.center.y - b.center.y)
    sideGroups.right.sort((a, b) => a.center.y - b.center.y)
    return sideGroups
  }

  const yClusters = clusterAxisValues(
    obstacles.map((obstacle) => obstacle.center.y),
  )

  for (const obstacle of obstacles) {
    const clusterIndex = getNearestClusterIndex(obstacle.center.y, yClusters)
    sideGroups[clusterIndex === 0 ? "top" : "bottom"].push(obstacle)
  }

  sideGroups.top.sort((a, b) => a.center.x - b.center.x)
  sideGroups.bottom.sort((a, b) => a.center.x - b.center.x)
  return sideGroups
}

function getInnerSoicBounds({
  bounds,
  orientation,
  sideGroups,
}: {
  bounds: Bounds
  orientation: SoicOrientation
  sideGroups: Record<SoicSide, Obstacle[]>
}): Bounds {
  if (orientation === "vertical-columns") {
    return {
      minX: Math.max(
        ...sideGroups.left.map((obstacle) => getBoundingBox(obstacle).maxX),
      ),
      maxX: Math.min(
        ...sideGroups.right.map((obstacle) => getBoundingBox(obstacle).minX),
      ),
      minY: bounds.minY,
      maxY: bounds.maxY,
    }
  }

  return {
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: Math.max(
      ...sideGroups.top.map((obstacle) => getBoundingBox(obstacle).maxY),
    ),
    maxY: Math.min(
      ...sideGroups.bottom.map((obstacle) => getBoundingBox(obstacle).minY),
    ),
  }
}

function getPadRegions(obstacles: Obstacle[]) {
  return obstacles.map((obstacle, index) => ({
    key: `pad:${obstacle.obstacleId ?? index}`,
    bounds: getBoundingBox(obstacle),
    regionType: "pad" as const,
    containsObstacle: true,
  }))
}

function createGapRegionsForSide({
  side,
  sideObstacles,
  bounds,
  centralBounds,
}: {
  side: SoicSide
  sideObstacles: Obstacle[]
  bounds: Bounds
  centralBounds: Bounds
}) {
  const regions: SoicRoutingRegion[] = []

  for (let index = 0; index < sideObstacles.length - 1; index++) {
    const currentBounds = getBoundingBox(sideObstacles[index]!)
    const nextBounds = getBoundingBox(sideObstacles[index + 1]!)
    let gapBounds: Bounds

    if (side === "left") {
      gapBounds = {
        minX: bounds.minX,
        maxX: centralBounds.minX,
        minY: currentBounds.maxY,
        maxY: nextBounds.minY,
      }
    } else if (side === "right") {
      gapBounds = {
        minX: centralBounds.maxX,
        maxX: bounds.maxX,
        minY: currentBounds.maxY,
        maxY: nextBounds.minY,
      }
    } else if (side === "top") {
      gapBounds = {
        minX: currentBounds.maxX,
        maxX: nextBounds.minX,
        minY: bounds.minY,
        maxY: centralBounds.minY,
      }
    } else {
      gapBounds = {
        minX: currentBounds.maxX,
        maxX: nextBounds.minX,
        minY: centralBounds.maxY,
        maxY: bounds.maxY,
      }
    }

    regions.push({
      key: `${side}-gap-${index}`,
      bounds: gapBounds,
      regionType: "pad-gap",
    })
  }

  return regions
}

/**
 * Builds a fixed SOIC topology: a central body-gap region plus the routable
 * regions between adjacent pads on the two populated sides.
 */
export class SoicTopologyGeneratorSolver extends BaseSolver {
  private output: SoicTopologyGeneratorSolverOutput | null = null

  constructor(public readonly inputProblem: SoicTopologyGeneratorSolverParams) {
    super()
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  override _step() {
    if (this.output) {
      this.solved = true
      return
    }

    const { bounds, layerCount, obstacles } = this.inputProblem.inputSrj
    const availableZ = getLayerRange(layerCount)
    const topologyObstacles = this.inputProblem.componentId
      ? obstacles.filter(
          (obstacle) => obstacle.componentId === this.inputProblem.componentId,
        )
      : obstacles
    const soicObstacles =
      topologyObstacles.length > 0 ? topologyObstacles : obstacles
    const orientation = getSoicOrientation(soicObstacles)
    const sideGroups = groupSoicPads({
      obstacles: soicObstacles,
      orientation,
    })
    const centralBounds = getInnerSoicBounds({
      bounds,
      orientation,
      sideGroups,
    })
    const nodeScopeId =
      this.inputProblem.componentId ??
      this.inputProblem.replacementObstacleId ??
      "component"
    const viaDiameter =
      this.inputProblem.viaDiameter ??
      getViaDimensions(this.inputProblem.inputSrj).padDiameter
    const obstacleMargin =
      this.inputProblem.obstacleMargin ??
      this.inputProblem.inputSrj.defaultObstacleMargin ??
      0.15
    const multiLayerThreshold = (viaDiameter + obstacleMargin) * 2
    const activeSides: SoicSide[] =
      orientation === "vertical-columns" ? ["left", "right"] : ["top", "bottom"]
    const regions: SoicRoutingRegion[] = [
      { key: "center", bounds: centralBounds, regionType: "center" },
      ...getPadRegions(soicObstacles),
      ...activeSides.flatMap((side) =>
        createGapRegionsForSide({
          side,
          sideObstacles: sideGroups[side],
          bounds,
          centralBounds,
        }),
      ),
    ]
    const routingRegions = regions.flatMap((region) =>
      createMeshNodesForRegion({
        nodeId: `soic:${nodeScopeId}:${region.key}`,
        bounds: region.bounds,
        availableZ,
        multiLayerThreshold,
        regionType: region.regionType,
        containsObstacle: region.containsObstacle,
      }),
    )

    this.output = {
      obstacles: obstacles.map((obstacle) => structuredClone(obstacle)),
      routingRegions,
    }
    this.stats = {
      componentId: this.inputProblem.componentId ?? null,
      replacementObstacleId: this.inputProblem.replacementObstacleId ?? null,
      layerCount,
      orientation,
      viaDiameter,
      obstacleMargin,
      multiLayerThreshold,
      firstSidePadCount: sideGroups[activeSides[0]!].length,
      secondSidePadCount: sideGroups[activeSides[1]!].length,
      multiLayerNodeCount: routingRegions.filter(
        (node) => node.availableZ.length > 1,
      ).length,
      totalMeshNodeCount: routingRegions.length,
    }
    this.solved = true
  }

  getOutput(): SoicTopologyGeneratorSolverOutput {
    if (!this.output) {
      throw new Error("SoicTopologyGeneratorSolver has not solved yet")
    }

    return this.output
  }
}

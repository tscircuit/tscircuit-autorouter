import { getBoundingBox } from "@tscircuit/math-utils"
import type { Bounds } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import { getLayerRange } from "lib/solvers/BgaTopologyGeneratorSolver/bgpTopologyGeneratorShared"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

const MIN_REGION_SIDE = 1e-6

type QfpSide = "top" | "right" | "bottom" | "left"

type RectRegion = {
  center: { x: number; y: number }
  width: number
  height: number
}

type QfpRoutingRegion = {
  key: string
  bounds: Bounds
  regionType: "center" | "pad" | "pad-gap" | "corner"
  isNarrowPadGap?: boolean
  containsObstacle?: boolean
  availableZ?: number[]
}

export interface QfpTopologyGeneratorSolverParams {
  inputSrj: SimpleRouteJson
  componentId?: string
  replacementObstacleId?: string
  viaDiameter?: number
  obstacleMargin?: number
}

export interface QfpTopologyGeneratorSolverOutput {
  /** Exact obstacle rectangles cloned from the input SRJ. This is the geometry source of truth. */
  obstacles: Obstacle[]
  /** Routing regions derived from the QFP pad ring. These are not obstacle rectangles. */
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

function getObstacleSide(obstacle: Obstacle, bounds: Bounds): QfpSide {
  const distances = [
    {
      side: "top" as const,
      distance: Math.abs(obstacle.center.y - bounds.minY),
    },
    {
      side: "right" as const,
      distance: Math.abs(bounds.maxX - obstacle.center.x),
    },
    {
      side: "bottom" as const,
      distance: Math.abs(bounds.maxY - obstacle.center.y),
    },
    {
      side: "left" as const,
      distance: Math.abs(obstacle.center.x - bounds.minX),
    },
  ]

  distances.sort((a, b) => a.distance - b.distance)
  return distances[0]!.side
}

function groupObstaclesBySide(obstacles: Obstacle[], bounds: Bounds) {
  const groups: Record<QfpSide, Obstacle[]> = {
    top: [],
    right: [],
    bottom: [],
    left: [],
  }

  for (const obstacle of obstacles) {
    groups[getObstacleSide(obstacle, bounds)].push(obstacle)
  }

  groups.top.sort((a, b) => a.center.x - b.center.x)
  groups.bottom.sort((a, b) => a.center.x - b.center.x)
  groups.left.sort((a, b) => a.center.y - b.center.y)
  groups.right.sort((a, b) => a.center.y - b.center.y)

  return groups
}

function createMeshNodesForRegion({
  nodeId,
  bounds,
  availableZ,
  multiLayerThreshold,
  regionType,
  isNarrowPadGap = false,
  containsObstacle = false,
}: {
  nodeId: string
  bounds: Bounds
  availableZ: number[]
  multiLayerThreshold: number
  regionType: QfpRoutingRegion["regionType"]
  isNarrowPadGap?: boolean
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
        _qfpRegionType: regionType,
        _isNarrowQfpPadGap: isNarrowPadGap,
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
    _qfpRegionType: regionType,
    _isNarrowQfpPadGap: isNarrowPadGap,
    _containsObstacle: containsObstacle,
  }))
}

function getObstacleAvailableZ(obstacle: Obstacle, layerCount: number) {
  return obstacle.zLayers && obstacle.zLayers.length > 0
    ? [...new Set(obstacle.zLayers)].sort((a, b) => a - b)
    : [
        ...new Set(
          obstacle.layers.map((layerName) =>
            mapLayerNameToZ(layerName, layerCount),
          ),
        ),
      ].sort((a, b) => a - b)
}

function getPadRegions(obstacles: Obstacle[], layerCount: number) {
  return obstacles.map((obstacle, index) => ({
    key: `pad:${obstacle.obstacleId ?? index}`,
    bounds: getBoundingBox(obstacle),
    regionType: "pad" as const,
    containsObstacle: true,
    availableZ: getObstacleAvailableZ(obstacle, layerCount),
  }))
}

function isNarrowPadGap(bounds: Bounds, narrowThreshold: number) {
  if (!isValidBounds(bounds)) return false
  return (
    Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) <=
    narrowThreshold
  )
}

function createGapRegionsForSide({
  side,
  sideObstacles,
  bounds,
  centralBounds,
  narrowThreshold,
}: {
  side: QfpSide
  sideObstacles: Obstacle[]
  bounds: Bounds
  centralBounds: Bounds
  narrowThreshold: number
}) {
  const regions: QfpRoutingRegion[] = []

  for (let index = 0; index < sideObstacles.length - 1; index++) {
    const currentBounds = getBoundingBox(sideObstacles[index]!)
    const nextBounds = getBoundingBox(sideObstacles[index + 1]!)
    let gapBounds: Bounds

    if (side === "top") {
      gapBounds = {
        minX: currentBounds.maxX,
        maxX: nextBounds.minX,
        minY: bounds.minY,
        maxY: centralBounds.minY,
      }
    } else if (side === "right") {
      gapBounds = {
        minX: centralBounds.maxX,
        maxX: bounds.maxX,
        minY: currentBounds.maxY,
        maxY: nextBounds.minY,
      }
    } else if (side === "bottom") {
      gapBounds = {
        minX: currentBounds.maxX,
        maxX: nextBounds.minX,
        minY: centralBounds.maxY,
        maxY: bounds.maxY,
      }
    } else {
      gapBounds = {
        minX: bounds.minX,
        maxX: centralBounds.minX,
        minY: currentBounds.maxY,
        maxY: nextBounds.minY,
      }
    }

    regions.push({
      key: `${side}-gap-${index}`,
      bounds: gapBounds,
      regionType: "pad-gap",
      isNarrowPadGap: isNarrowPadGap(gapBounds, narrowThreshold),
    })
  }

  return regions
}

function getInnerQfpBounds({
  bounds,
  sideGroups,
}: {
  bounds: Bounds
  sideGroups: Record<QfpSide, Obstacle[]>
}) {
  const leftInner =
    sideGroups.left.length > 0
      ? Math.max(
          ...sideGroups.left.map((obstacle) => getBoundingBox(obstacle).maxX),
        )
      : bounds.minX
  const rightInner =
    sideGroups.right.length > 0
      ? Math.min(
          ...sideGroups.right.map((obstacle) => getBoundingBox(obstacle).minX),
        )
      : bounds.maxX
  const topInner =
    sideGroups.top.length > 0
      ? Math.max(
          ...sideGroups.top.map((obstacle) => getBoundingBox(obstacle).maxY),
        )
      : bounds.minY
  const bottomInner =
    sideGroups.bottom.length > 0
      ? Math.min(
          ...sideGroups.bottom.map((obstacle) => getBoundingBox(obstacle).minY),
        )
      : bounds.maxY

  return {
    minX: leftInner,
    maxX: rightInner,
    minY: topInner,
    maxY: bottomInner,
  }
}

function getCornerRegions({
  bounds,
  centralBounds,
  sideGroups,
}: {
  bounds: Bounds
  centralBounds: Bounds
  sideGroups: Record<QfpSide, Obstacle[]>
}) {
  const firstTopBounds = sideGroups.top[0]
    ? getBoundingBox(sideGroups.top[0])
    : null
  const lastTopBounds = sideGroups.top.at(-1)
    ? getBoundingBox(sideGroups.top.at(-1)!)
    : null
  const firstRightBounds = sideGroups.right[0]
    ? getBoundingBox(sideGroups.right[0])
    : null
  const lastRightBounds = sideGroups.right.at(-1)
    ? getBoundingBox(sideGroups.right.at(-1)!)
    : null
  const firstBottomBounds = sideGroups.bottom[0]
    ? getBoundingBox(sideGroups.bottom[0])
    : null
  const lastBottomBounds = sideGroups.bottom.at(-1)
    ? getBoundingBox(sideGroups.bottom.at(-1)!)
    : null
  const firstLeftBounds = sideGroups.left[0]
    ? getBoundingBox(sideGroups.left[0])
    : null
  const lastLeftBounds = sideGroups.left.at(-1)
    ? getBoundingBox(sideGroups.left.at(-1)!)
    : null

  return [
    {
      key: "corner-nw-outer",
      regionType: "corner" as const,
      bounds: {
        minX: bounds.minX,
        maxX: centralBounds.minX,
        minY: bounds.minY,
        maxY: centralBounds.minY,
      },
    },
    {
      key: "corner-nw-top",
      regionType: "corner" as const,
      bounds: {
        minX: centralBounds.minX,
        maxX: firstTopBounds?.minX ?? centralBounds.minX,
        minY: bounds.minY,
        maxY: centralBounds.minY,
      },
    },
    {
      key: "corner-nw-left",
      regionType: "corner" as const,
      bounds: {
        minX: bounds.minX,
        maxX: centralBounds.minX,
        minY: centralBounds.minY,
        maxY: firstLeftBounds?.minY ?? centralBounds.minY,
      },
    },
    {
      key: "corner-ne-outer",
      regionType: "corner" as const,
      bounds: {
        minX: centralBounds.maxX,
        maxX: bounds.maxX,
        minY: bounds.minY,
        maxY: centralBounds.minY,
      },
    },
    {
      key: "corner-ne-top",
      regionType: "corner" as const,
      bounds: {
        minX: lastTopBounds?.maxX ?? centralBounds.maxX,
        maxX: centralBounds.maxX,
        minY: bounds.minY,
        maxY: centralBounds.minY,
      },
    },
    {
      key: "corner-ne-right",
      regionType: "corner" as const,
      bounds: {
        minX: centralBounds.maxX,
        maxX: bounds.maxX,
        minY: centralBounds.minY,
        maxY: firstRightBounds?.minY ?? centralBounds.minY,
      },
    },
    {
      key: "corner-se-outer",
      regionType: "corner" as const,
      bounds: {
        minX: centralBounds.maxX,
        maxX: bounds.maxX,
        minY: centralBounds.maxY,
        maxY: bounds.maxY,
      },
    },
    {
      key: "corner-se-right",
      regionType: "corner" as const,
      bounds: {
        minX: centralBounds.maxX,
        maxX: bounds.maxX,
        minY: lastRightBounds?.maxY ?? centralBounds.maxY,
        maxY: centralBounds.maxY,
      },
    },
    {
      key: "corner-se-bottom",
      regionType: "corner" as const,
      bounds: {
        minX: lastBottomBounds?.maxX ?? centralBounds.maxX,
        maxX: centralBounds.maxX,
        minY: centralBounds.maxY,
        maxY: bounds.maxY,
      },
    },
    {
      key: "corner-sw-outer",
      regionType: "corner" as const,
      bounds: {
        minX: bounds.minX,
        maxX: centralBounds.minX,
        minY: centralBounds.maxY,
        maxY: bounds.maxY,
      },
    },
    {
      key: "corner-sw-bottom",
      regionType: "corner" as const,
      bounds: {
        minX: centralBounds.minX,
        maxX: firstBottomBounds?.minX ?? centralBounds.minX,
        minY: centralBounds.maxY,
        maxY: bounds.maxY,
      },
    },
    {
      key: "corner-sw-left",
      regionType: "corner" as const,
      bounds: {
        minX: bounds.minX,
        maxX: centralBounds.minX,
        minY: lastLeftBounds?.maxY ?? centralBounds.maxY,
        maxY: centralBounds.maxY,
      },
    },
  ]
}

/**
 * Builds the fixed QFP topology: one large central region plus perimeter gap
 * and corner regions between the package pads.
 */
export class QfpTopologyGeneratorSolver extends BaseSolver {
  private output: QfpTopologyGeneratorSolverOutput | null = null

  constructor(public readonly inputProblem: QfpTopologyGeneratorSolverParams) {
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
    const padRingObstacles =
      topologyObstacles.length > 0 ? topologyObstacles : obstacles
    const sideGroups = groupObstaclesBySide(padRingObstacles, bounds)
    const centralBounds = getInnerQfpBounds({ bounds, sideGroups })
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
    const multiLayerThreshold = viaDiameter + obstacleMargin * 2
    const narrowPadGapThreshold =
      this.inputProblem.inputSrj.minTraceWidth + obstacleMargin * 2
    const regions: QfpRoutingRegion[] = [
      { key: "center", bounds: centralBounds, regionType: "center" },
      ...getPadRegions(padRingObstacles, layerCount),
      ...createGapRegionsForSide({
        side: "top",
        sideObstacles: sideGroups.top,
        bounds,
        centralBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createGapRegionsForSide({
        side: "right",
        sideObstacles: sideGroups.right,
        bounds,
        centralBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createGapRegionsForSide({
        side: "bottom",
        sideObstacles: sideGroups.bottom,
        bounds,
        centralBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createGapRegionsForSide({
        side: "left",
        sideObstacles: sideGroups.left,
        bounds,
        centralBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...getCornerRegions({ bounds, centralBounds, sideGroups }),
    ]
    const routingRegions = regions.flatMap((region) =>
      createMeshNodesForRegion({
        nodeId: `qfp:${nodeScopeId}:${region.key}`,
        bounds: region.bounds,
        availableZ: region.availableZ ?? availableZ,
        multiLayerThreshold,
        regionType: region.regionType,
        isNarrowPadGap: region.isNarrowPadGap,
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
      viaDiameter,
      obstacleMargin,
      multiLayerThreshold,
      narrowPadGapThreshold,
      narrowPadGapNodeCount: routingRegions.filter(
        (node) => node._isNarrowQfpPadGap,
      ).length,
      topPadCount: sideGroups.top.length,
      rightPadCount: sideGroups.right.length,
      bottomPadCount: sideGroups.bottom.length,
      leftPadCount: sideGroups.left.length,
      multiLayerNodeCount: routingRegions.filter(
        (node) => node.availableZ.length > 1,
      ).length,
      totalMeshNodeCount: routingRegions.length,
    }
    this.solved = true
  }

  getOutput(): QfpTopologyGeneratorSolverOutput {
    if (!this.output) {
      throw new Error("QfpTopologyGeneratorSolver has not solved yet")
    }

    return this.output
  }
}

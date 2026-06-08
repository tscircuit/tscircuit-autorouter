import { getBoundingBox } from "@tscircuit/math-utils"
import type { Bounds } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import { getLayerRange } from "lib/solvers/BgaTopologyGeneratorSolver/bgpTopologyGeneratorShared"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

const MIN_REGION_SIDE = 1e-6
const MIN_QFP_PAD_ASPECT_RATIO = 1.5

type QfpSide = "top" | "right" | "bottom" | "left"

type RectRegion = {
  center: { x: number; y: number }
  width: number
  height: number
}

type QfpThermalPadRoutingRegion = {
  key: string
  bounds: Bounds
  regionType: "pad" | "pad-gap" | "corner"
  isNarrowPadGap?: boolean
  containsObstacle?: boolean
}

export interface QfpThermalPadTopologyGeneratorSolverParams
  extends TopologyGeneratorSolverParams {}

export interface QfpThermalPadTopologyGeneratorSolverOutput
  extends TopologyGeneratorSolverOutput {
  /** Exact obstacle rectangles cloned from the input SRJ. This is the geometry source of truth. */
  obstacles: Obstacle[]
  /** Routing regions derived from the QFP pad ring and central thermal pad. */
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

function getObstacleAspectRatio(obstacle: Obstacle) {
  const minSide = Math.min(obstacle.width, obstacle.height)
  const maxSide = Math.max(obstacle.width, obstacle.height)

  if (minSide <= 0) return 0

  return maxSide / minSide
}

function isPerimeterQfpPadObstacle(obstacle: Obstacle) {
  return getObstacleAspectRatio(obstacle) >= MIN_QFP_PAD_ASPECT_RATIO
}

function splitQfpThermalPadObstacles(obstacles: Obstacle[]) {
  const padRingObstacles = obstacles.filter(isPerimeterQfpPadObstacle)
  const thermalPadObstacles = obstacles.filter(
    (obstacle) => !isPerimeterQfpPadObstacle(obstacle),
  )

  return { padRingObstacles, thermalPadObstacles }
}

function combineObstacleBounds(obstacles: Obstacle[]): Bounds | null {
  if (obstacles.length === 0) return null

  return obstacles.reduce((combinedBounds, obstacle) => {
    const obstacleBounds = getBoundingBox(obstacle)

    return {
      minX: Math.min(combinedBounds.minX, obstacleBounds.minX),
      maxX: Math.max(combinedBounds.maxX, obstacleBounds.maxX),
      minY: Math.min(combinedBounds.minY, obstacleBounds.minY),
      maxY: Math.max(combinedBounds.maxY, obstacleBounds.maxY),
    }
  }, getBoundingBox(obstacles[0]!))
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
  regionType: QfpThermalPadRoutingRegion["regionType"]
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

function getPadRegions(obstacles: Obstacle[]) {
  return obstacles.map((obstacle, index) => ({
    key: `pad:${obstacle.obstacleId ?? index}`,
    bounds: getBoundingBox(obstacle),
    regionType: "pad" as const,
    containsObstacle: true,
  }))
}

function getThermalPadRegions(obstacles: Obstacle[]) {
  return obstacles.map((obstacle, index) => ({
    key: `thermal-pad:${obstacle.obstacleId ?? index}`,
    bounds: getBoundingBox(obstacle),
    regionType: "pad" as const,
    containsObstacle: true,
  }))
}

function isNarrowPadGap(bounds: Bounds, narrowThreshold: number) {
  if (!isValidBounds(bounds)) return false
  return (
    Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) <=
    narrowThreshold
  )
}

function createOuterGapRegionsForSide({
  side,
  sideObstacles,
  bounds,
  innerBounds,
  narrowThreshold,
}: {
  side: QfpSide
  sideObstacles: Obstacle[]
  bounds: Bounds
  innerBounds: Bounds
  narrowThreshold: number
}) {
  const regions: QfpThermalPadRoutingRegion[] = []

  for (let index = 0; index < sideObstacles.length - 1; index++) {
    const currentBounds = getBoundingBox(sideObstacles[index]!)
    const nextBounds = getBoundingBox(sideObstacles[index + 1]!)
    let gapBounds: Bounds

    if (side === "top") {
      gapBounds = {
        minX: currentBounds.maxX,
        maxX: nextBounds.minX,
        minY: bounds.minY,
        maxY: innerBounds.minY,
      }
    } else if (side === "right") {
      gapBounds = {
        minX: innerBounds.maxX,
        maxX: bounds.maxX,
        minY: currentBounds.maxY,
        maxY: nextBounds.minY,
      }
    } else if (side === "bottom") {
      gapBounds = {
        minX: currentBounds.maxX,
        maxX: nextBounds.minX,
        minY: innerBounds.maxY,
        maxY: bounds.maxY,
      }
    } else {
      gapBounds = {
        minX: bounds.minX,
        maxX: innerBounds.minX,
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

function createInnerPadClearanceRegionsForSide({
  side,
  sideObstacles,
  thermalPadBounds,
  narrowThreshold,
}: {
  side: QfpSide
  sideObstacles: Obstacle[]
  thermalPadBounds: Bounds
  narrowThreshold: number
}) {
  const regions: QfpThermalPadRoutingRegion[] = []

  for (let index = 0; index < sideObstacles.length; index++) {
    const currentBounds = getBoundingBox(sideObstacles[index]!)
    const previousBounds = sideObstacles[index - 1]
      ? getBoundingBox(sideObstacles[index - 1]!)
      : null
    const nextBounds = sideObstacles[index + 1]
      ? getBoundingBox(sideObstacles[index + 1]!)
      : null
    let clearanceBounds: Bounds

    if (side === "top") {
      clearanceBounds = {
        minX: previousBounds
          ? (previousBounds.maxX + currentBounds.minX) / 2
          : currentBounds.minX,
        maxX: nextBounds
          ? (currentBounds.maxX + nextBounds.minX) / 2
          : currentBounds.maxX,
        minY: currentBounds.maxY,
        maxY: thermalPadBounds.minY,
      }
    } else if (side === "right") {
      clearanceBounds = {
        minX: thermalPadBounds.maxX,
        maxX: currentBounds.minX,
        minY: previousBounds
          ? (previousBounds.maxY + currentBounds.minY) / 2
          : currentBounds.minY,
        maxY: nextBounds
          ? (currentBounds.maxY + nextBounds.minY) / 2
          : currentBounds.maxY,
      }
    } else if (side === "bottom") {
      clearanceBounds = {
        minX: previousBounds
          ? (previousBounds.maxX + currentBounds.minX) / 2
          : currentBounds.minX,
        maxX: nextBounds
          ? (currentBounds.maxX + nextBounds.minX) / 2
          : currentBounds.maxX,
        minY: thermalPadBounds.maxY,
        maxY: currentBounds.minY,
      }
    } else {
      clearanceBounds = {
        minX: currentBounds.maxX,
        maxX: thermalPadBounds.minX,
        minY: previousBounds
          ? (previousBounds.maxY + currentBounds.minY) / 2
          : currentBounds.minY,
        maxY: nextBounds
          ? (currentBounds.maxY + nextBounds.minY) / 2
          : currentBounds.maxY,
      }
    }

    regions.push({
      key: `inner-${side}-pad-${index}`,
      bounds: clearanceBounds,
      regionType: "pad-gap",
      isNarrowPadGap: isNarrowPadGap(clearanceBounds, narrowThreshold),
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

function getOuterCornerRegions({
  bounds,
  innerBounds,
  sideGroups,
}: {
  bounds: Bounds
  innerBounds: Bounds
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
        maxX: innerBounds.minX,
        minY: bounds.minY,
        maxY: innerBounds.minY,
      },
    },
    {
      key: "corner-nw-top",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.minX,
        maxX: firstTopBounds?.minX ?? innerBounds.minX,
        minY: bounds.minY,
        maxY: innerBounds.minY,
      },
    },
    {
      key: "corner-nw-left",
      regionType: "corner" as const,
      bounds: {
        minX: bounds.minX,
        maxX: innerBounds.minX,
        minY: innerBounds.minY,
        maxY: firstLeftBounds?.minY ?? innerBounds.minY,
      },
    },
    {
      key: "corner-ne-outer",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.maxX,
        maxX: bounds.maxX,
        minY: bounds.minY,
        maxY: innerBounds.minY,
      },
    },
    {
      key: "corner-ne-top",
      regionType: "corner" as const,
      bounds: {
        minX: lastTopBounds?.maxX ?? innerBounds.maxX,
        maxX: innerBounds.maxX,
        minY: bounds.minY,
        maxY: innerBounds.minY,
      },
    },
    {
      key: "corner-ne-right",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.maxX,
        maxX: bounds.maxX,
        minY: innerBounds.minY,
        maxY: firstRightBounds?.minY ?? innerBounds.minY,
      },
    },
    {
      key: "corner-se-outer",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.maxX,
        maxX: bounds.maxX,
        minY: innerBounds.maxY,
        maxY: bounds.maxY,
      },
    },
    {
      key: "corner-se-right",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.maxX,
        maxX: bounds.maxX,
        minY: lastRightBounds?.maxY ?? innerBounds.maxY,
        maxY: innerBounds.maxY,
      },
    },
    {
      key: "corner-se-bottom",
      regionType: "corner" as const,
      bounds: {
        minX: lastBottomBounds?.maxX ?? innerBounds.maxX,
        maxX: innerBounds.maxX,
        minY: innerBounds.maxY,
        maxY: bounds.maxY,
      },
    },
    {
      key: "corner-sw-outer",
      regionType: "corner" as const,
      bounds: {
        minX: bounds.minX,
        maxX: innerBounds.minX,
        minY: innerBounds.maxY,
        maxY: bounds.maxY,
      },
    },
    {
      key: "corner-sw-bottom",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.minX,
        maxX: firstBottomBounds?.minX ?? innerBounds.minX,
        minY: innerBounds.maxY,
        maxY: bounds.maxY,
      },
    },
    {
      key: "corner-sw-left",
      regionType: "corner" as const,
      bounds: {
        minX: bounds.minX,
        maxX: innerBounds.minX,
        minY: lastLeftBounds?.maxY ?? innerBounds.maxY,
        maxY: innerBounds.maxY,
      },
    },
  ]
}

function getInnerCornerRegions({
  innerBounds,
  thermalPadBounds,
  sideGroups,
}: {
  innerBounds: Bounds
  thermalPadBounds: Bounds
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
      key: "inner-corner-nw-core",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.minX,
        maxX: thermalPadBounds.minX,
        minY: innerBounds.minY,
        maxY: thermalPadBounds.minY,
      },
    },
    {
      key: "inner-corner-nw-top",
      regionType: "corner" as const,
      bounds: {
        minX: thermalPadBounds.minX,
        maxX: firstTopBounds?.minX ?? thermalPadBounds.minX,
        minY: innerBounds.minY,
        maxY: thermalPadBounds.minY,
      },
    },
    {
      key: "inner-corner-nw-left",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.minX,
        maxX: thermalPadBounds.minX,
        minY: thermalPadBounds.minY,
        maxY: firstLeftBounds?.minY ?? thermalPadBounds.minY,
      },
    },
    {
      key: "inner-corner-ne-core",
      regionType: "corner" as const,
      bounds: {
        minX: thermalPadBounds.maxX,
        maxX: innerBounds.maxX,
        minY: innerBounds.minY,
        maxY: thermalPadBounds.minY,
      },
    },
    {
      key: "inner-corner-ne-top",
      regionType: "corner" as const,
      bounds: {
        minX: lastTopBounds?.maxX ?? thermalPadBounds.maxX,
        maxX: thermalPadBounds.maxX,
        minY: innerBounds.minY,
        maxY: thermalPadBounds.minY,
      },
    },
    {
      key: "inner-corner-ne-right",
      regionType: "corner" as const,
      bounds: {
        minX: thermalPadBounds.maxX,
        maxX: innerBounds.maxX,
        minY: thermalPadBounds.minY,
        maxY: firstRightBounds?.minY ?? thermalPadBounds.minY,
      },
    },
    {
      key: "inner-corner-se-core",
      regionType: "corner" as const,
      bounds: {
        minX: thermalPadBounds.maxX,
        maxX: innerBounds.maxX,
        minY: thermalPadBounds.maxY,
        maxY: innerBounds.maxY,
      },
    },
    {
      key: "inner-corner-se-right",
      regionType: "corner" as const,
      bounds: {
        minX: thermalPadBounds.maxX,
        maxX: innerBounds.maxX,
        minY: lastRightBounds?.maxY ?? thermalPadBounds.maxY,
        maxY: thermalPadBounds.maxY,
      },
    },
    {
      key: "inner-corner-se-bottom",
      regionType: "corner" as const,
      bounds: {
        minX: lastBottomBounds?.maxX ?? thermalPadBounds.maxX,
        maxX: thermalPadBounds.maxX,
        minY: thermalPadBounds.maxY,
        maxY: innerBounds.maxY,
      },
    },
    {
      key: "inner-corner-sw-core",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.minX,
        maxX: thermalPadBounds.minX,
        minY: thermalPadBounds.maxY,
        maxY: innerBounds.maxY,
      },
    },
    {
      key: "inner-corner-sw-bottom",
      regionType: "corner" as const,
      bounds: {
        minX: thermalPadBounds.minX,
        maxX: firstBottomBounds?.minX ?? thermalPadBounds.minX,
        minY: thermalPadBounds.maxY,
        maxY: innerBounds.maxY,
      },
    },
    {
      key: "inner-corner-sw-left",
      regionType: "corner" as const,
      bounds: {
        minX: innerBounds.minX,
        maxX: thermalPadBounds.minX,
        minY: lastLeftBounds?.maxY ?? thermalPadBounds.maxY,
        maxY: thermalPadBounds.maxY,
      },
    },
  ]
}

/**
 * Builds the fixed QFP-with-thermal-pad topology. The central region is an
 * obstacle, so free space is modeled as perimeter gaps, inner pad clearances,
 * outer corners, and three rectangular regions around each thermal-pad corner.
 */
export class QfpThermalPadTopologyGeneratorSolver extends BaseSolver {
  static readonly componentKind = "qfp_thermalpad"

  private output: QfpThermalPadTopologyGeneratorSolverOutput | null = null

  constructor(
    public readonly inputProblem: QfpThermalPadTopologyGeneratorSolverParams,
  ) {
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
    const componentObstacles =
      topologyObstacles.length > 0 ? topologyObstacles : obstacles
    const { padRingObstacles, thermalPadObstacles } =
      splitQfpThermalPadObstacles(componentObstacles)
    const sideGroups = groupObstaclesBySide(padRingObstacles, bounds)
    const innerBounds = getInnerQfpBounds({ bounds, sideGroups })
    const thermalPadBounds = combineObstacleBounds(thermalPadObstacles)

    if (!thermalPadBounds) {
      this.failed = true
      this.error = "QfpThermalPadTopologyGeneratorSolver requires a thermal pad"
      return
    }

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
    const regions: QfpThermalPadRoutingRegion[] = [
      ...getPadRegions(padRingObstacles),
      ...getThermalPadRegions(thermalPadObstacles),
      ...createOuterGapRegionsForSide({
        side: "top",
        sideObstacles: sideGroups.top,
        bounds,
        innerBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createOuterGapRegionsForSide({
        side: "right",
        sideObstacles: sideGroups.right,
        bounds,
        innerBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createOuterGapRegionsForSide({
        side: "bottom",
        sideObstacles: sideGroups.bottom,
        bounds,
        innerBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createOuterGapRegionsForSide({
        side: "left",
        sideObstacles: sideGroups.left,
        bounds,
        innerBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createInnerPadClearanceRegionsForSide({
        side: "top",
        sideObstacles: sideGroups.top,
        thermalPadBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createInnerPadClearanceRegionsForSide({
        side: "right",
        sideObstacles: sideGroups.right,
        thermalPadBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createInnerPadClearanceRegionsForSide({
        side: "bottom",
        sideObstacles: sideGroups.bottom,
        thermalPadBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...createInnerPadClearanceRegionsForSide({
        side: "left",
        sideObstacles: sideGroups.left,
        thermalPadBounds,
        narrowThreshold: narrowPadGapThreshold,
      }),
      ...getInnerCornerRegions({
        innerBounds,
        thermalPadBounds,
        sideGroups,
      }),
      ...getOuterCornerRegions({ bounds, innerBounds, sideGroups }),
    ]
    const routingRegions = regions.flatMap((region) =>
      createMeshNodesForRegion({
        nodeId: `qfp_thermalpad:${nodeScopeId}:${region.key}`,
        bounds: region.bounds,
        availableZ,
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
      thermalPadCount: thermalPadObstacles.length,
      perimeterPadCount: padRingObstacles.length,
      innerCornerRectCount: routingRegions.filter((node) =>
        node.capacityMeshNodeId.includes(":inner-corner-"),
      ).length,
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

  getOutput(): QfpThermalPadTopologyGeneratorSolverOutput {
    if (!this.output) {
      throw new Error("QfpThermalPadTopologyGeneratorSolver has not solved yet")
    }

    return this.output
  }
}

TopologyGenerator.register(QfpThermalPadTopologyGeneratorSolver)

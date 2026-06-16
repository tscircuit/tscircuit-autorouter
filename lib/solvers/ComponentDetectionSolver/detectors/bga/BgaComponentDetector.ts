import type { Obstacle } from "lib/types"
import type { ComponentDetector, ComponentDetectorParams } from "../types"

const MIN_BGA_AXIS_COUNT = 3
const MIN_BGA_GRID_OCCUPANCY = 0.5
const MAX_BGA_PAD_SIZE_VARIANCE = 0.01
const MAX_BGA_PAD_ASPECT_RATIO = 1.5
const MIN_INTERIOR_PAD_COUNT = 1
const AXIS_CLUSTER_EPSILON = 1e-3

export function clusterAxisValues(values: number[]) {
  const sortedValues = [...values].sort((a, b) => a - b)
  const clustered: number[] = []

  for (const value of sortedValues) {
    const previousValue = clustered[clustered.length - 1]
    if (
      previousValue === undefined ||
      Math.abs(value - previousValue) > AXIS_CLUSTER_EPSILON
    ) {
      clustered.push(value)
    }
  }

  return clustered
}

function hasUniformDimensionWithinTolerance(values: number[]) {
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)

  if (minValue <= 0) return false

  return maxValue / minValue <= 1 + MAX_BGA_PAD_SIZE_VARIANCE
}

function hasUniformPadDimensions(memberObstacles: Obstacle[]) {
  return (
    hasUniformDimensionWithinTolerance(
      memberObstacles.map((obstacle) => obstacle.width),
    ) &&
    hasUniformDimensionWithinTolerance(
      memberObstacles.map((obstacle) => obstacle.height),
    )
  )
}

function hasBgaLikePadAspectRatio(memberObstacles: Obstacle[]): boolean {
  return memberObstacles.every((obstacle) => {
    const minDim = Math.min(obstacle.width, obstacle.height)
    const maxDim = Math.max(obstacle.width, obstacle.height)
    if (minDim <= 0) return false
    return maxDim / minDim <= MAX_BGA_PAD_ASPECT_RATIO
  })
}

function hasInteriorPads(
  memberObstacles: Obstacle[],
  rowAxisValues: number[],
  columnAxisValues: number[],
) {
  if (rowAxisValues.length < MIN_BGA_AXIS_COUNT) return false
  if (columnAxisValues.length < MIN_BGA_AXIS_COUNT) return false

  const interiorRows = new Set(rowAxisValues.slice(1, -1))
  const interiorColumns = new Set(columnAxisValues.slice(1, -1))

  let interiorPadCount = 0

  for (const obstacle of memberObstacles) {
    if (
      interiorRows.has(obstacle.center.y) &&
      interiorColumns.has(obstacle.center.x)
    ) {
      interiorPadCount += 1
    }
  }

  return interiorPadCount >= MIN_INTERIOR_PAD_COUNT
}

export function isBgaLikeComponent(memberObstacles: Obstacle[]) {
  if (!hasUniformPadDimensions(memberObstacles)) return false
  if (!hasBgaLikePadAspectRatio(memberObstacles)) return false

  const rowAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.y),
  )
  const columnAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.x),
  )
  const rowCount = rowAxisValues.length
  const columnCount = columnAxisValues.length

  if (rowCount < MIN_BGA_AXIS_COUNT || columnCount < MIN_BGA_AXIS_COUNT) {
    return false
  }

  const gridCellCount = rowCount * columnCount
  const gridOccupancy =
    gridCellCount > 0 ? memberObstacles.length / gridCellCount : 0

  if (gridOccupancy < MIN_BGA_GRID_OCCUPANCY) return false

  if (!hasInteriorPads(memberObstacles, rowAxisValues, columnAxisValues)) {
    return false
  }

  return true
}

export class BgaComponentDetector implements ComponentDetector {
  static readonly componentKind = "bga"
  readonly componentKind = BgaComponentDetector.componentKind

  constructor(readonly params: ComponentDetectorParams) {}

  static isMatch({ memberObstacles }: ComponentDetectorParams) {
    return isBgaLikeComponent(memberObstacles)
  }
}

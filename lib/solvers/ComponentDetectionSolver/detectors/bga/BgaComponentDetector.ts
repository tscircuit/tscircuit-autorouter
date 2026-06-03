import type { Obstacle } from "lib/types"
import type { ComponentDetector, ComponentDetectorParams } from "../types"

const MIN_BGA_AXIS_COUNT = 3
const MIN_BGA_TWO_AXIS_COUNT = 2
const MIN_BGA_LONG_AXIS_COUNT_FOR_TWO_AXIS = 4
const MIN_BGA_GRID_OCCUPANCY = 0.5
const MAX_BGA_PAD_SIZE_VARIANCE = 0.01
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

export function isBgaLikeComponent(memberObstacles: Obstacle[]) {
  if (!hasUniformPadDimensions(memberObstacles)) return false

  const rowAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.y),
  )
  const columnAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.x),
  )
  const rowCount = rowAxisValues.length
  const columnCount = columnAxisValues.length
  const gridCellCount = rowCount * columnCount
  const gridOccupancy =
    gridCellCount > 0 ? memberObstacles.length / gridCellCount : 0
  const hasStandardBgaAxisCounts =
    rowCount >= MIN_BGA_AXIS_COUNT && columnCount >= MIN_BGA_AXIS_COUNT
  const hasTwoAxisBgaAxisCounts =
    (rowCount === MIN_BGA_TWO_AXIS_COUNT &&
      columnCount >= MIN_BGA_LONG_AXIS_COUNT_FOR_TWO_AXIS) ||
    (columnCount === MIN_BGA_TWO_AXIS_COUNT &&
      rowCount >= MIN_BGA_LONG_AXIS_COUNT_FOR_TWO_AXIS)
  const hasSupportedAxisCounts =
    hasStandardBgaAxisCounts || hasTwoAxisBgaAxisCounts

  return hasSupportedAxisCounts && gridOccupancy >= MIN_BGA_GRID_OCCUPANCY
}

export class BgaComponentDetector implements ComponentDetector {
  static readonly componentKind = "bga"
  readonly componentKind = BgaComponentDetector.componentKind

  constructor(readonly params: ComponentDetectorParams) {}

  static isMatch({ memberObstacles }: ComponentDetectorParams) {
    return isBgaLikeComponent(memberObstacles)
  }
}

import { getViaDimensions } from "lib/utils/getViaDimensions"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import {
  clusterAxisValues,
  isBgaLikeComponent,
} from "../bga/BgaComponentDetector"
import type { ComponentDetector, ComponentDetectorParams } from "../types"

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

function getTwoAxisInnerGap({
  memberObstacles,
  rowAxisValues,
  columnAxisValues,
}: {
  memberObstacles: Obstacle[]
  rowAxisValues: number[]
  columnAxisValues: number[]
}) {
  if (rowAxisValues.length === 2 && columnAxisValues.length >= 4) {
    const rows = [[], []] as [Obstacle[], Obstacle[]]

    for (const obstacle of memberObstacles) {
      rows[getNearestClusterIndex(obstacle.center.y, rowAxisValues)]!.push(
        obstacle,
      )
    }

    return (
      Math.min(
        ...rows[1].map((obstacle) => obstacle.center.y - obstacle.height / 2),
      ) -
      Math.max(
        ...rows[0].map((obstacle) => obstacle.center.y + obstacle.height / 2),
      )
    )
  }

  if (columnAxisValues.length === 2 && rowAxisValues.length >= 4) {
    const columns = [[], []] as [Obstacle[], Obstacle[]]

    for (const obstacle of memberObstacles) {
      columns[
        getNearestClusterIndex(obstacle.center.x, columnAxisValues)
      ]!.push(obstacle)
    }

    return (
      Math.min(
        ...columns[1].map((obstacle) => obstacle.center.x - obstacle.width / 2),
      ) -
      Math.max(
        ...columns[0].map((obstacle) => obstacle.center.x + obstacle.width / 2),
      )
    )
  }

  return null
}

export function isSoicLikeComponent({
  memberObstacles,
  inputSrj,
}: {
  memberObstacles: Obstacle[]
  inputSrj: SimpleRouteJson
}) {
  if (!isBgaLikeComponent(memberObstacles)) return false

  const rowAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.y),
  )
  const columnAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.x),
  )
  const isTwoRowOrColumnBga =
    (rowAxisValues.length === 2 && columnAxisValues.length >= 4) ||
    (columnAxisValues.length === 2 && rowAxisValues.length >= 4)

  if (!isTwoRowOrColumnBga) return false

  const innerGap = getTwoAxisInnerGap({
    memberObstacles,
    rowAxisValues,
    columnAxisValues,
  })
  if (innerGap === null) return false

  const viaDiameter = getViaDimensions(inputSrj).padDiameter
  const obstacleMargin = inputSrj.defaultObstacleMargin ?? 0.15
  const soicGapThreshold = (viaDiameter + obstacleMargin) * 2

  return innerGap > soicGapThreshold
}

export class SoicComponentDetector implements ComponentDetector {
  static readonly componentKind = "soic"
  readonly componentKind = SoicComponentDetector.componentKind

  constructor(readonly params: ComponentDetectorParams) {}

  static isMatch(params: ComponentDetectorParams) {
    return isSoicLikeComponent(params)
  }
}

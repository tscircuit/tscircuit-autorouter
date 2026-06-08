import type { Obstacle } from "lib/types"
import { getBoundsForObstacles } from "lib/utils/getBoundsForObstacles"

const MIN_QFP_PADS_PER_SIDE = 3
const MAX_QFP_CENTER_NEAREST_SIDE_RATIO = 0.25
const MIN_QFP_PAD_ASPECT_RATIO = 1.5

function getNearestSideCounts(memberObstacles: Obstacle[]) {
  const bounds = getBoundsForObstacles(memberObstacles)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const counts = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  }

  if (width <= 0 || height <= 0) return { counts, maxNearestSideRatio: 1 }

  let maxNearestSideRatio = 0

  for (const obstacle of memberObstacles) {
    const isHorizontalPad = obstacle.width > obstacle.height
    const distances = [
      {
        side: "top" as const,
        distance: Math.abs(obstacle.center.y - bounds.minY),
        axisSpan: height,
        orientationMatches: !isHorizontalPad,
      },
      {
        side: "right" as const,
        distance: Math.abs(bounds.maxX - obstacle.center.x),
        axisSpan: width,
        orientationMatches: isHorizontalPad,
      },
      {
        side: "bottom" as const,
        distance: Math.abs(bounds.maxY - obstacle.center.y),
        axisSpan: height,
        orientationMatches: !isHorizontalPad,
      },
      {
        side: "left" as const,
        distance: Math.abs(obstacle.center.x - bounds.minX),
        axisSpan: width,
        orientationMatches: isHorizontalPad,
      },
    ]
      .filter((candidate) => candidate.orientationMatches)
      .sort((a, b) => a.distance - b.distance)
    const nearest = distances[0]!

    counts[nearest.side] += 1
    maxNearestSideRatio = Math.max(
      maxNearestSideRatio,
      nearest.distance / nearest.axisSpan,
    )
  }

  return { counts, maxNearestSideRatio }
}

function isQfpPerimeterPadObstacle(obstacle: Obstacle) {
  const minSide = Math.min(obstacle.width, obstacle.height)
  const maxSide = Math.max(obstacle.width, obstacle.height)

  return minSide > 0 && maxSide / minSide >= MIN_QFP_PAD_ASPECT_RATIO
}

function getQfpPerimeterPadObstacles(memberObstacles: Obstacle[]) {
  return memberObstacles.filter(isQfpPerimeterPadObstacle)
}

function areCentralThermalPadObstacles({
  perimeterPadObstacles,
  thermalPadObstacles,
}: {
  perimeterPadObstacles: Obstacle[]
  thermalPadObstacles: Obstacle[]
}) {
  if (thermalPadObstacles.length === 0) return true

  const perimeterBounds = getBoundsForObstacles(perimeterPadObstacles)
  const width = perimeterBounds.maxX - perimeterBounds.minX
  const height = perimeterBounds.maxY - perimeterBounds.minY
  const centralMinX = perimeterBounds.minX + width * 0.2
  const centralMaxX = perimeterBounds.maxX - width * 0.2
  const centralMinY = perimeterBounds.minY + height * 0.2
  const centralMaxY = perimeterBounds.maxY - height * 0.2
  const perimeterPadThickness = Math.min(
    ...perimeterPadObstacles.map((obstacle) =>
      Math.min(obstacle.width, obstacle.height),
    ),
  )

  return thermalPadObstacles.every((obstacle) => {
    const minSide = Math.min(obstacle.width, obstacle.height)

    return (
      obstacle.center.x >= centralMinX &&
      obstacle.center.x <= centralMaxX &&
      obstacle.center.y >= centralMinY &&
      obstacle.center.y <= centralMaxY &&
      minSide > perimeterPadThickness
    )
  })
}

function hasQfpPerimeterPadRing(perimeterPadObstacles: Obstacle[]) {
  if (perimeterPadObstacles.length < MIN_QFP_PADS_PER_SIDE * 4) return false

  const { counts, maxNearestSideRatio } = getNearestSideCounts(
    perimeterPadObstacles,
  )

  return (
    counts.top >= MIN_QFP_PADS_PER_SIDE &&
    counts.right >= MIN_QFP_PADS_PER_SIDE &&
    counts.bottom >= MIN_QFP_PADS_PER_SIDE &&
    counts.left >= MIN_QFP_PADS_PER_SIDE &&
    maxNearestSideRatio <= MAX_QFP_CENTER_NEAREST_SIDE_RATIO
  )
}

function splitQfpMemberObstacles(memberObstacles: Obstacle[]) {
  const perimeterPadObstacles = getQfpPerimeterPadObstacles(memberObstacles)
  const thermalPadObstacles = memberObstacles.filter(
    (obstacle) => !isQfpPerimeterPadObstacle(obstacle),
  )

  return { perimeterPadObstacles, thermalPadObstacles }
}

export function isQfpThermalPadLikeComponent(memberObstacles: Obstacle[]) {
  const { perimeterPadObstacles, thermalPadObstacles } =
    splitQfpMemberObstacles(memberObstacles)

  if (thermalPadObstacles.length === 0) return false
  if (!hasQfpPerimeterPadRing(perimeterPadObstacles)) return false

  return areCentralThermalPadObstacles({
    perimeterPadObstacles,
    thermalPadObstacles,
  })
}

export function isQfpLikeComponent(memberObstacles: Obstacle[]) {
  const { perimeterPadObstacles, thermalPadObstacles } =
    splitQfpMemberObstacles(memberObstacles)

  if (thermalPadObstacles.length > 0) return false
  if (
    !areCentralThermalPadObstacles({
      perimeterPadObstacles,
      thermalPadObstacles,
    })
  ) {
    return false
  }

  return hasQfpPerimeterPadRing(perimeterPadObstacles)
}

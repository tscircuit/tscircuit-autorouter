import type { Obstacle, SimpleRouteJson } from "lib/types"

const normalizeRotation = (rotationDegrees: number) =>
  ((rotationDegrees % 360) + 360) % 360

const QUARTER_TURN_TOLERANCE_DEGREES = 0.01
const TRACE_OBSTACLE_MAX_APPROX_RECT_LENGTH = 0.75

const isAxisAlignedRotation = (rotationDegrees: number) => {
  const normalizedRotation = normalizeRotation(rotationDegrees)
  const axisAlignedAngles = [0, 90, 180, 270] as const

  return axisAlignedAngles.some((angle) => {
    const angularDistance = Math.min(
      Math.abs(normalizedRotation - angle),
      360 - Math.abs(normalizedRotation - angle),
    )

    return angularDistance <= QUARTER_TURN_TOLERANCE_DEGREES
  })
}

const getNearestAxisAlignedRotation = (rotationDegrees: number) => {
  const normalizedRotation = normalizeRotation(rotationDegrees)
  const axisAlignedAngles = [0, 90, 180, 270] as const

  for (const angle of axisAlignedAngles) {
    const angularDistance = Math.min(
      Math.abs(normalizedRotation - angle),
      360 - Math.abs(normalizedRotation - angle),
    )

    if (angularDistance <= QUARTER_TURN_TOLERANCE_DEGREES) return angle
  }

  return null
}

const removeAxisAlignedRotation = (
  obstacle: Obstacle,
  rotationDegrees: number,
): Obstacle => {
  const {
    ccwRotationDegrees: _ccwRotationDegrees,
    ...obstacleWithoutRotation
  } = obstacle
  const axisAlignedRotation = getNearestAxisAlignedRotation(rotationDegrees)

  if (axisAlignedRotation === 90 || axisAlignedRotation === 270) {
    return {
      ...obstacleWithoutRotation,
      width: obstacle.height,
      height: obstacle.width,
    }
  }

  return obstacleWithoutRotation
}

interface Point {
  x: number
  y: number
}

export interface RotatedRect {
  center: Point
  width: number
  height: number
  rotation: number
}

interface Rect {
  center: Point
  width: number
  height: number
}

export function generateApproximatingRects(
  rotatedRect: RotatedRect,
  numRects = 2,
): Rect[] {
  const { center, width, height, rotation } = rotatedRect
  const rects: Rect[] = []
  const rectCount = Math.max(1, Math.ceil(numRects))

  const angleRad = (rotation * Math.PI) / 180
  const cosAngle = Math.cos(angleRad)
  const sinAngle = Math.sin(angleRad)

  if (width >= height) {
    const sliceWidth = width / rectCount

    for (let i = 0; i < rectCount; i++) {
      const x = (i - rectCount / 2 + 0.5) * sliceWidth
      const rotatedX = x * cosAngle
      const rotatedY = x * sinAngle

      const coverageWidth =
        Math.abs(sliceWidth * cosAngle) + Math.abs(height * sinAngle)
      const coverageHeight =
        Math.abs(sliceWidth * sinAngle) + Math.abs(height * cosAngle)

      rects.push({
        center: {
          x: center.x + rotatedX,
          y: center.y + rotatedY,
        },
        width: coverageWidth,
        height: coverageHeight,
      })
    }
  } else {
    const sliceHeight = height / rectCount

    for (let i = 0; i < rectCount; i++) {
      const y = (i - rectCount / 2 + 0.5) * sliceHeight
      const rotatedX = -y * sinAngle
      const rotatedY = y * cosAngle

      const coverageWidth =
        Math.abs(width * cosAngle) + Math.abs(sliceHeight * sinAngle)
      const coverageHeight =
        Math.abs(width * sinAngle) + Math.abs(sliceHeight * cosAngle)

      rects.push({
        center: {
          x: center.x + rotatedX,
          y: center.y + rotatedY,
        },
        width: coverageWidth,
        height: coverageHeight,
      })
    }
  }

  return rects
}

const getApproximationRectCount = (obstacle: Obstacle): number => {
  if (!obstacle.obstacleId?.startsWith("trace_obstacle_")) return 2

  return Math.max(
    2,
    Math.ceil(
      Math.max(obstacle.width, obstacle.height) /
        TRACE_OBSTACLE_MAX_APPROX_RECT_LENGTH,
    ),
  )
}

const convertObstacleToOldFormat = (obstacle: Obstacle): Obstacle[] => {
  const rotationDegrees = obstacle.ccwRotationDegrees

  if (
    typeof rotationDegrees !== "number" ||
    !Number.isFinite(rotationDegrees)
  ) {
    return [obstacle]
  }

  if (isAxisAlignedRotation(rotationDegrees)) {
    return [removeAxisAlignedRotation(obstacle, rotationDegrees)]
  }

  const {
    ccwRotationDegrees: _ccwRotationDegrees,
    ...obstacleWithoutRotation
  } = obstacle

  return generateApproximatingRects(
    {
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      rotation: rotationDegrees,
    },
    getApproximationRectCount(obstacle),
  ).map((rect) => ({
    ...obstacleWithoutRotation,
    center: rect.center,
    width: rect.width,
    height: rect.height,
  }))
}

export const addApproximatingRectsToSrj = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  const obstacles = [] as Obstacle[]

  for (const obstacle of srj.obstacles) {
    const convertedObstacle = convertObstacleToOldFormat(obstacle)
    obstacles.push(...convertedObstacle)
  }

  return {
    ...srj,
    obstacles,
  }
}

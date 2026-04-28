import type { Obstacle, SimpleRouteJson } from "lib/types"

const normalizeRotation = (rotationDegrees: number) =>
  ((rotationDegrees % 360) + 360) % 360

const QUARTER_TURN_TOLERANCE_DEGREES = 0.01
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

  const angleRad = (rotation * Math.PI) / 180
  const cosAngle = Math.cos(angleRad)
  const sinAngle = Math.sin(angleRad)

  const normalizedRotation = ((rotation % 360) + 360) % 360
  const sliceAlongWidth =
    height <= width
      ? (normalizedRotation >= 45 && normalizedRotation < 135) ||
        (normalizedRotation >= 225 && normalizedRotation < 315)
      : (normalizedRotation >= 135 && normalizedRotation < 225) ||
        normalizedRotation >= 315 ||
        normalizedRotation < 45

  if (sliceAlongWidth) {
    const sliceWidth = width / numRects

    for (let i = 0; i < numRects; i++) {
      const x = (i - numRects / 2 + 0.5) * sliceWidth

      const rotatedX = -x * cosAngle
      const rotatedY = -x * sinAngle

      const coverageWidth = sliceWidth * 1.1
      const coverageHeight =
        Math.abs(height * cosAngle) + Math.abs(sliceWidth * sinAngle)

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
    const sliceHeight = height / numRects

    for (let i = 0; i < numRects; i++) {
      const y = (i - numRects / 2 + 0.5) * sliceHeight

      const rotatedX = -y * sinAngle
      const rotatedY = y * cosAngle

      const coverageWidth =
        Math.abs(width * cosAngle) + Math.abs(sliceHeight * sinAngle)
      const coverageHeight = sliceHeight * 1.1

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

const convertObstacleToOldFormat = (obstacle: Obstacle): Obstacle[] => {
  const rotationDegrees = obstacle.ccwRotationDegrees

  if (
    typeof rotationDegrees !== "number" ||
    !Number.isFinite(rotationDegrees) ||
    isAxisAlignedRotation(rotationDegrees)
  ) {
    return [obstacle]
  }

  return generateApproximatingRects({
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    rotation: rotationDegrees,
  }).map((rect) => ({
    ...obstacle,
    center: rect.center,
    width: rect.width,
    height: rect.height,
    ccwRotationDegrees: rotationDegrees,
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

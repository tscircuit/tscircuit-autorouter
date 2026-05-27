import { pointToBoxDistance } from "@tscircuit/math-utils"
import {
  getConnectionPointLayers,
  type Obstacle,
  type SimpleRouteJson,
} from "lib/types"

const normalizeRotation = (rotationDegrees: number) =>
  ((rotationDegrees % 360) + 360) % 360

const QUARTER_TURN_TOLERANCE_DEGREES = 0.01
const TRACE_OBSTACLE_MAX_APPROX_RECT_LENGTH = 0.75
const ROTATED_OBSTACLE_MAX_APPROX_RECT_LENGTH = 0.4
const SLENDER_OBSTACLE_MAX_APPROX_RECT_LENGTH = 0.75
const SLENDER_OBSTACLE_ASPECT_RATIO = 2
const WIDE_SLENDER_OBSTACLE_MIN_SHORT_SIDE = 0.9
const CENTERLINE_APPROX_RECT_SIZE_FACTOR = 0.75
const MANY_CONNECTED_ROTATED_OBSTACLES_THRESHOLD = 20
const SPARSE_CENTERLINE_STEP_FACTOR = 2

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

const sharesAnyLayer = (pointLayers: string[], obstacleLayers: string[]) =>
  pointLayers.some((layer) => obstacleLayers.includes(layer))

const getConnectionAnchorRectIndex = (params: {
  obstacle: Obstacle
  rects: Rect[]
  srj: SimpleRouteJson
}) => {
  const { obstacle, rects, srj } = params

  if (obstacle.connectedTo.length === 0) {
    return -1
  }

  const rectHits = new Array(rects.length).fill(0)
  const rectMinDistanceToMatchedPoint = new Array(rects.length).fill(
    Number.POSITIVE_INFINITY,
  )

  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (!sharesAnyLayer(getConnectionPointLayers(point), obstacle.layers)) {
        continue
      }

      for (const [index, rect] of rects.entries()) {
        if (pointToBoxDistance(point, rect) !== 0) {
          continue
        }

        rectHits[index] += 1
        const distanceToRectCenter =
          (rect.center.x - point.x) ** 2 + (rect.center.y - point.y) ** 2
        rectMinDistanceToMatchedPoint[index] = Math.min(
          rectMinDistanceToMatchedPoint[index],
          distanceToRectCenter,
        )
      }
    }
  }

  const bestRectHits = Math.max(...rectHits)
  if (bestRectHits > 0) {
    return rects.reduce((bestIndex, _rect, index) => {
      if (rectHits[index] !== bestRectHits) {
        return bestIndex
      }
      if (bestIndex === -1) {
        return index
      }

      return rectMinDistanceToMatchedPoint[index] <
        rectMinDistanceToMatchedPoint[bestIndex]
        ? index
        : bestIndex
    }, -1)
  }

  return rects.reduce((closestIndex, rect, index) => {
    const closestRect = rects[closestIndex]!
    const closestDistance =
      (closestRect.center.x - obstacle.center.x) ** 2 +
      (closestRect.center.y - obstacle.center.y) ** 2
    const distance =
      (rect.center.x - obstacle.center.x) ** 2 +
      (rect.center.y - obstacle.center.y) ** 2

    return distance < closestDistance ? index : closestIndex
  }, 0)
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

const generateGridApproximatingRects = (
  rotatedRect: RotatedRect,
  maxLocalRectLength: number,
): Rect[] => {
  const { center, width, height, rotation } = rotatedRect
  const xCount = Math.max(1, Math.ceil(width / maxLocalRectLength))
  const yCount = Math.max(1, Math.ceil(height / maxLocalRectLength))
  const cellWidth = width / xCount
  const cellHeight = height / yCount
  const angleRad = (rotation * Math.PI) / 180
  const cosAngle = Math.cos(angleRad)
  const sinAngle = Math.sin(angleRad)
  const rects: Rect[] = []

  for (let ix = 0; ix < xCount; ix++) {
    const localX = (ix - xCount / 2 + 0.5) * cellWidth

    for (let iy = 0; iy < yCount; iy++) {
      const localY = (iy - yCount / 2 + 0.5) * cellHeight

      rects.push({
        center: {
          x: center.x + localX * cosAngle - localY * sinAngle,
          y: center.y + localX * sinAngle + localY * cosAngle,
        },
        width: Math.abs(cellWidth * cosAngle) + Math.abs(cellHeight * sinAngle),
        height:
          Math.abs(cellWidth * sinAngle) + Math.abs(cellHeight * cosAngle),
      })
    }
  }

  return rects
}

const generateCenterlineApproximatingRects = (
  rotatedRect: RotatedRect,
  rectCount: number,
): Rect[] => {
  const { center, width, height, rotation } = rotatedRect
  const longSide = Math.max(width, height)
  const shortSide = Math.min(width, height)
  const clampedRectCount = Math.max(1, Math.ceil(rectCount))
  const stepLength = longSide / clampedRectCount
  const angleRad = (rotation * Math.PI) / 180
  const cosAngle = Math.cos(angleRad)
  const sinAngle = Math.sin(angleRad)
  const rectSize = Math.max(
    stepLength,
    shortSide * CENTERLINE_APPROX_RECT_SIZE_FACTOR,
  )
  const rects: Rect[] = []

  for (let i = 0; i < clampedRectCount; i++) {
    const localOffset = (i - clampedRectCount / 2 + 0.5) * stepLength
    const rotatedX =
      width >= height ? localOffset * cosAngle : -localOffset * sinAngle
    const rotatedY =
      width >= height ? localOffset * sinAngle : localOffset * cosAngle

    rects.push({
      center: {
        x: center.x + rotatedX,
        y: center.y + rotatedY,
      },
      width: rectSize,
      height: rectSize,
    })
  }

  return rects
}

const generateSparseCenterlineApproximatingRects = (
  rotatedRect: RotatedRect,
): Rect[] => {
  const { center, width, height, rotation } = rotatedRect
  const longSide = Math.max(width, height)
  const shortSide = Math.min(width, height)
  const rectCount = Math.max(
    1,
    Math.ceil(longSide / (shortSide * SPARSE_CENTERLINE_STEP_FACTOR)),
  )
  const stepLength = longSide / rectCount
  const angleRad = (rotation * Math.PI) / 180
  const cosAngle = Math.cos(angleRad)
  const sinAngle = Math.sin(angleRad)
  const rects: Rect[] = []

  for (let i = 0; i < rectCount; i++) {
    const localOffset = (i - rectCount / 2 + 0.5) * stepLength
    const rotatedX =
      width >= height ? localOffset * cosAngle : -localOffset * sinAngle
    const rotatedY =
      width >= height ? localOffset * sinAngle : localOffset * cosAngle

    rects.push({
      center: {
        x: center.x + rotatedX,
        y: center.y + rotatedY,
      },
      width: shortSide,
      height: shortSide,
    })
  }

  return rects
}

const getMaxLocalApproximationRectLength = (obstacle: Obstacle): number => {
  if (obstacle.obstacleId?.startsWith("trace_obstacle_")) {
    return TRACE_OBSTACLE_MAX_APPROX_RECT_LENGTH
  }

  return ROTATED_OBSTACLE_MAX_APPROX_RECT_LENGTH
}

const getRotatedObstacleApproximationRectCount = (
  obstacle: Obstacle,
): number | null => {
  const longSide = Math.max(obstacle.width, obstacle.height)
  const shortSide = Math.min(obstacle.width, obstacle.height)

  if (obstacle.obstacleId?.startsWith("trace_obstacle_")) {
    return Math.max(
      2,
      Math.ceil(longSide / TRACE_OBSTACLE_MAX_APPROX_RECT_LENGTH),
    )
  }

  if (shortSide <= 0) return 2

  if (
    longSide / shortSide < SLENDER_OBSTACLE_ASPECT_RATIO ||
    shortSide >= WIDE_SLENDER_OBSTACLE_MIN_SHORT_SIDE
  ) {
    return null
  }

  return Math.max(
    2,
    Math.ceil(longSide / SLENDER_OBSTACLE_MAX_APPROX_RECT_LENGTH),
  )
}

/**
 * Converts one obstacle into the axis-aligned representation expected by older
 * routing stages.
 *
 * @param params.obstacle Obstacle to normalize or approximate.
 * @param params.obstacleIndex Source index used only when synthesizing a
 * stable parent obstacle id for connected obstacles without one.
 * @param params.srj Route input used to preserve connectivity on the best
 * approximation rectangle.
 * @param params.useSparseCenterlineApproximation When `true`, connected rotated
 * obstacles use a coarser approximation to reduce obstacle count.
 * @returns One obstacle when the input is already axis-aligned, otherwise the
 * approximating rectangles that replace it.
 * @caution Child approximation rectangles clear `connectedTo` unless they are
 * selected as the anchor rectangle. Use `parentObstacleId` to relate siblings
 * back to the same source obstacle.
 */
const convertObstacleToOldFormat = (params: {
  obstacle: Obstacle
  obstacleIndex: number
  srj: SimpleRouteJson
  useSparseCenterlineApproximation?: boolean
}): Obstacle[] => {
  const { obstacle, obstacleIndex, srj, useSparseCenterlineApproximation } =
    params
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

  const rotatedRect = {
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    rotation: rotationDegrees,
  }
  const rectCount = getRotatedObstacleApproximationRectCount(obstacle)
  const rects = useSparseCenterlineApproximation
    ? generateSparseCenterlineApproximatingRects(rotatedRect)
    : rectCount === null
      ? generateGridApproximatingRects(
          rotatedRect,
          getMaxLocalApproximationRectLength(obstacle),
        )
      : obstacle.obstacleId?.startsWith("trace_obstacle_")
        ? generateApproximatingRects(rotatedRect, rectCount)
        : generateCenterlineApproximatingRects(rotatedRect, rectCount)
  const connectedRectIndex = getConnectionAnchorRectIndex({
    obstacle,
    rects,
    srj,
  })
  const parentObstacleId =
    obstacleWithoutRotation.obstacleId ??
    obstacleWithoutRotation.parentObstacleId ??
    (connectedRectIndex !== -1
      ? `connected_obstacle_${obstacleIndex}`
      : undefined)

  return rects.map((rect, index) => ({
    ...obstacleWithoutRotation,
    obstacleId:
      index === connectedRectIndex
        ? parentObstacleId
        : parentObstacleId
          ? `${parentObstacleId}_approx_${index}`
          : undefined,
    parentObstacleId:
      connectedRectIndex !== -1 &&
      index !== connectedRectIndex &&
      parentObstacleId !== undefined
        ? parentObstacleId
        : obstacleWithoutRotation.parentObstacleId,
    connectedTo:
      index === connectedRectIndex ? obstacleWithoutRotation.connectedTo : [],
    center: rect.center,
    width: rect.width,
    height: rect.height,
  }))
}

/**
 * Replaces rotated SRJ obstacles with axis-aligned approximating rectangles.
 *
 * @param srj SimpleRouteJson input to normalize for later routing stages.
 * @returns A cloned SRJ object whose `obstacles` list contains only
 * axis-aligned rectangles.
 * @remarks When multiple approximations collapse to the same bounds, their
 * connectivity is merged to keep the obstacle list compact.
 */
export const addApproximatingRectsToSrj = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  const obstaclesByRect = new Map<string, Obstacle>()
  const connectedRotatedObstacleCount = srj.obstacles.filter(
    (obstacle) =>
      obstacle.connectedTo.length > 0 &&
      typeof obstacle.ccwRotationDegrees === "number" &&
      Number.isFinite(obstacle.ccwRotationDegrees) &&
      !isAxisAlignedRotation(obstacle.ccwRotationDegrees),
  ).length
  const useSparseCenterlineApproximation =
    connectedRotatedObstacleCount > MANY_CONNECTED_ROTATED_OBSTACLES_THRESHOLD

  for (const [obstacleIndex, obstacle] of srj.obstacles.entries()) {
    const convertedObstacles = convertObstacleToOldFormat({
      obstacle,
      obstacleIndex,
      srj,
      useSparseCenterlineApproximation:
        useSparseCenterlineApproximation &&
        obstacle.connectedTo.length > 0 &&
        !obstacle.obstacleId?.startsWith("trace_obstacle_"),
    })
    for (const convertedObstacle of convertedObstacles) {
      const key = [
        convertedObstacle.center.x.toFixed(6),
        convertedObstacle.center.y.toFixed(6),
        convertedObstacle.width.toFixed(6),
        convertedObstacle.height.toFixed(6),
        convertedObstacle.layers.join(","),
      ].join(":")
      const existingObstacle = obstaclesByRect.get(key)

      if (!existingObstacle) {
        obstaclesByRect.set(key, convertedObstacle)
        continue
      }

      existingObstacle.connectedTo = [
        ...new Set([
          ...existingObstacle.connectedTo,
          ...convertedObstacle.connectedTo,
        ]),
      ]
      existingObstacle.parentObstacleId =
        existingObstacle.parentObstacleId ?? convertedObstacle.parentObstacleId
    }
  }

  return {
    ...srj,
    obstacles: [...obstaclesByRect.values()],
  }
}

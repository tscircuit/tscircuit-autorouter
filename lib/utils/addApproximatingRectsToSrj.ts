import { CONNECTION_REGION_SIZE } from "@tscircuit/fixed-via-hypergraph-solver/lib/FixedViaHypergraphSolver/via-graph-generator/createConnectionRegion"
import type { ConnectionPoint, Obstacle, SimpleRouteJson } from "lib/types"
import {
  getBoundFromCenteredRect,
  distance as calculateDistance,
  isPointInsideBounds,
} from "@tscircuit/math-utils"
import { calculateMse } from "scripts/highdensity-benchmark/metrics/calculateMse"

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

const getConnectionPointLayers = (point: ConnectionPoint): string[] =>
  "layers" in point ? point.layers : [point.layer]

const isPointInsideObstacle = (point: ConnectionPoint, obstacle: Obstacle) => {
  if (
    getConnectionPointLayers(point).length > 0 &&
    !getConnectionPointLayers(point).some((layer) =>
      obstacle.layers.includes(layer),
    )
  ) {
    return false
  }

  return isPointInsideBounds(point, getBoundFromCenteredRect(obstacle))
}

const clampPointToObstacle = (point: ConnectionPoint, obstacle: Obstacle) => {
  const { minX, maxX, minY, maxY } = getBoundFromCenteredRect(obstacle)

  return {
    x: Math.max(minX, Math.min(maxX, point.x)),
    y: Math.max(minY, Math.min(maxY, point.y)),
  }
}

const getObstacleKey = (obstacle: Obstacle, index: number) =>
  obstacle.obstacleId ?? `${obstacle.componentId ?? "obstacle"}_${index}`

const getPointConnectionIds = (point: ConnectionPoint) =>
  [point.pointId, point.pcb_port_id].filter((id): id is string => Boolean(id))

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

const convertObstacleToOldFormat = (
  obstacle: Obstacle,
  opts: { useSparseCenterlineApproximation?: boolean } = {},
): Obstacle[] => {
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
  const rects = opts.useSparseCenterlineApproximation
    ? generateSparseCenterlineApproximatingRects(rotatedRect)
    : rectCount === null
      ? generateGridApproximatingRects(
          rotatedRect,
          getMaxLocalApproximationRectLength(obstacle),
        )
      : obstacle.obstacleId?.startsWith("trace_obstacle_")
        ? generateApproximatingRects(rotatedRect, rectCount)
        : generateCenterlineApproximatingRects(rotatedRect, rectCount)
  const connectedRectIndex =
    obstacle.connectedTo.length > 0
      ? rects.reduce((closestIndex, rect, index) => {
          const closestRect = rects[closestIndex]!
          const closestDistance =
            (closestRect.center.x - obstacle.center.x) ** 2 +
            (closestRect.center.y - obstacle.center.y) ** 2
          const distance =
            (rect.center.x - obstacle.center.x) ** 2 +
            (rect.center.y - obstacle.center.y) ** 2

          return distance < closestDistance ? index : closestIndex
        }, 0)
      : -1

  return rects.map((rect, index) => ({
    ...obstacleWithoutRotation,
    obstacleId:
      index === connectedRectIndex
        ? obstacleWithoutRotation.obstacleId
        : obstacleWithoutRotation.obstacleId
          ? `${obstacleWithoutRotation.obstacleId}_approx_${index}`
          : undefined,
    connectedTo: obstacleWithoutRotation.connectedTo,
    center: rect.center,
    width: rect.width,
    height: rect.height,
  }))
}

export const addApproximatingRectsToSrj = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  const obstaclesByRect = new Map<string, Obstacle>()
  const approximatedObstaclesBySource = new Map<string, Obstacle[]>()
  const originalObstaclesBySource = new Map<string, Obstacle>()
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
    const convertedObstacle = convertObstacleToOldFormat(obstacle, {
      useSparseCenterlineApproximation:
        useSparseCenterlineApproximation &&
        obstacle.connectedTo.length > 0 &&
        !obstacle.obstacleId?.startsWith("trace_obstacle_"),
    })
    const sourceKey = getObstacleKey(obstacle, obstacleIndex)
    approximatedObstaclesBySource.set(sourceKey, convertedObstacle)
    originalObstaclesBySource.set(sourceKey, obstacle)

    for (const converted of convertedObstacle) {
      const key = [
        converted.center.x.toFixed(6),
        converted.center.y.toFixed(6),
        converted.width.toFixed(6),
        converted.height.toFixed(6),
        converted.layers.join(","),
      ].join(":")
      const existingObstacle = obstaclesByRect.get(key)

      if (!existingObstacle) {
        obstaclesByRect.set(key, converted)
        continue
      }

      existingObstacle.connectedTo = [
        ...new Set([...existingObstacle.connectedTo, ...converted.connectedTo]),
      ]
    }
  }

  const repairedConnections = srj.connections.map((connection) => ({
    ...connection,
    pointsToConnect: connection.pointsToConnect.map((point) => {
      const pointIds = getPointConnectionIds(point)
      if (pointIds.length === 0) return point

      for (const [sourceKey, originalObstacle] of originalObstaclesBySource) {
        if (
          !pointIds.some((pointId) =>
            originalObstacle.connectedTo.includes(pointId),
          )
        ) {
          continue
        }

        if (!isPointInsideObstacle(point, originalObstacle)) continue

        const approximatedObstacles =
          approximatedObstaclesBySource.get(sourceKey) ?? []
        if (approximatedObstacles.length === 0) continue

        if (
          approximatedObstacles.some((obstacle) =>
            isPointInsideObstacle(point, obstacle),
          )
        ) {
          return point
        }

        let nearestObstacle = approximatedObstacles[0]!
        let nearestDistance = Number.POSITIVE_INFINITY

        for (const obstacle of approximatedObstacles) {
          const clampedPoint = clampPointToObstacle(point, obstacle)
          const distance = calculateDistance(clampedPoint, point)

          if (distance < nearestDistance) {
            nearestDistance = distance
            nearestObstacle = obstacle
          }
        }

        return {
          ...point,
          ...clampPointToObstacle(point, nearestObstacle),
        }
      }

      return point
    }),
  }))

  return {
    ...srj,
    connections: repairedConnections,
    obstacles: [...obstaclesByRect.values()],
  }
}

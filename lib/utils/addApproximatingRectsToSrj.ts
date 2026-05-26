import type { Obstacle, SimpleRouteJson } from "lib/types"

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

type AnchorableConnectionPoint = {
  x: number
  y: number
  identifiers: string[]
  layerNames: string[]
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

/**
 * Builds a stable obstacle identity when the source obstacle does not already
 * provide one.
 */
const getFallbackParentObstacleId = (obstacle: Obstacle) =>
  [
    "derived-obstacle",
    obstacle.componentId ?? "no-component",
    obstacle.type,
    obstacle.center.x.toFixed(6),
    obstacle.center.y.toFixed(6),
    obstacle.width.toFixed(6),
    obstacle.height.toFixed(6),
    (obstacle.ccwRotationDegrees ?? 0).toFixed(6),
    [...obstacle.layers].sort().join(","),
  ].join(":")

/**
 * Picks the approximated rectangle that should preserve the obstacle's
 * connectivity metadata.
 */
const getAnchorRectIndex = ({
  obstacle,
  rects,
  connectionPoints,
}: {
  obstacle: Obstacle
  rects: Rect[]
  connectionPoints: AnchorableConnectionPoint[]
}) => {
  const obstacleIdentifiers = new Set(obstacle.connectedTo)

  const matchedRectIndex = rects.findIndex((rect) =>
    connectionPoints.some((point) => {
      if (
        Math.abs(point.x - rect.center.x) > rect.width / 2 + 1e-6 ||
        Math.abs(point.y - rect.center.y) > rect.height / 2 + 1e-6
      ) {
        return false
      }
      if (point.layerNames.length > 0) {
        const sharesLayer = point.layerNames.some((layerName) =>
          obstacle.layers.includes(layerName),
        )
        if (!sharesLayer) return false
      }
      return point.identifiers.some((identifier) =>
        obstacleIdentifiers.has(identifier),
      )
    }),
  )

  if (matchedRectIndex !== -1) return matchedRectIndex

  return obstacle.connectedTo.length > 0
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
    : 0
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
  opts: {
    useSparseCenterlineApproximation?: boolean
    connectionPoints?: AnchorableConnectionPoint[]
  } = {},
): Obstacle[] => {
  const parentObstacleId =
    obstacle.parentObstacleId ??
    obstacle.obstacleId ??
    getFallbackParentObstacleId(obstacle)
  const rotationDegrees = obstacle.ccwRotationDegrees

  if (
    typeof rotationDegrees !== "number" ||
    !Number.isFinite(rotationDegrees)
  ) {
    return [{ ...obstacle, parentObstacleId }]
  }

  if (isAxisAlignedRotation(rotationDegrees)) {
    return [
      {
        ...removeAxisAlignedRotation(obstacle, rotationDegrees),
        parentObstacleId,
      },
    ]
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
  const anchorRectIndex = getAnchorRectIndex({
    obstacle,
    rects,
    connectionPoints: opts.connectionPoints ?? [],
  })
  const anchorObstacleId =
    obstacleWithoutRotation.obstacleId ?? `${parentObstacleId}:anchor`

  return rects.map((rect, index) => ({
    ...obstacleWithoutRotation,
    parentObstacleId,
    obstacleId:
      index === anchorRectIndex
        ? anchorObstacleId
        : `${anchorObstacleId}_approx_${index}`,
    connectedTo:
      index === anchorRectIndex ? obstacleWithoutRotation.connectedTo : [],
    center: rect.center,
    width: rect.width,
    height: rect.height,
  }))
}

export const addApproximatingRectsToSrj = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  const obstaclesByRect = new Map<string, Obstacle>()
  const connectionPoints: AnchorableConnectionPoint[] = srj.connections.flatMap(
    (connection) =>
      connection.pointsToConnect.map((point) => ({
        x: point.x,
        y: point.y,
        identifiers: [
          connection.name,
          connection.rootConnectionName,
          ...("mergedConnectionNames" in connection
            ? (connection.mergedConnectionNames ?? [])
            : []),
          point.pointId,
          point.pcb_port_id,
        ].filter((value): value is string => Boolean(value)),
        layerNames:
          "layer" in point
            ? [point.layer]
            : "layers" in point
              ? point.layers
              : [],
      })),
  )
  const connectedRotatedObstacleCount = srj.obstacles.filter(
    (obstacle) =>
      obstacle.connectedTo.length > 0 &&
      typeof obstacle.ccwRotationDegrees === "number" &&
      Number.isFinite(obstacle.ccwRotationDegrees) &&
      !isAxisAlignedRotation(obstacle.ccwRotationDegrees),
  ).length
  const useSparseCenterlineApproximation =
    connectedRotatedObstacleCount > MANY_CONNECTED_ROTATED_OBSTACLES_THRESHOLD

  for (const obstacle of srj.obstacles) {
    const convertedObstacle = convertObstacleToOldFormat(obstacle, {
      connectionPoints,
      useSparseCenterlineApproximation:
        useSparseCenterlineApproximation &&
        obstacle.connectedTo.length > 0 &&
        !obstacle.obstacleId?.startsWith("trace_obstacle_"),
    })
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

      existingObstacle.parentObstacleId ??= converted.parentObstacleId
      existingObstacle.connectedTo = [
        ...new Set([...existingObstacle.connectedTo, ...converted.connectedTo]),
      ]
    }
  }

  return {
    ...srj,
    obstacles: [...obstaclesByRect.values()],
  }
}

import { pointToBoundsDistance } from "@tscircuit/math-utils"

export type PointBoundsPosition = "on-boundary" | "inside" | "outside"

const isFiniteNumber = ({ value }: { value: number }): boolean =>
  Number.isFinite(value)

const isWithinRange = ({
  value,
  min,
  max,
}: {
  value: number
  min: number
  max: number
}): boolean => value >= min && value <= max

const isWithinEpsilon = ({
  value,
  target,
  epsilon,
}: {
  value: number
  target: number
  epsilon: number
}): boolean => Math.abs(value - target) <= epsilon

export const classifyPointInBounds = ({
  point,
  bounds,
  epsilon = 1e-6,
}: {
  point: { x: number; y: number }
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  epsilon?: number
}): PointBoundsPosition => {
  const finiteValues = [
    point.x,
    point.y,
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
  ]

  if (!finiteValues.every((value) => isFiniteNumber({ value }))) {
    return "outside"
  }

  const distanceToBounds = pointToBoundsDistance(point, bounds)
  if (distanceToBounds > epsilon) {
    return "outside"
  }

  const isNearMinX = isWithinEpsilon({
    value: point.x,
    target: bounds.minX,
    epsilon,
  })
  const isNearMaxX = isWithinEpsilon({
    value: point.x,
    target: bounds.maxX,
    epsilon,
  })
  const isNearMinY = isWithinEpsilon({
    value: point.y,
    target: bounds.minY,
    epsilon,
  })
  const isNearMaxY = isWithinEpsilon({
    value: point.y,
    target: bounds.maxY,
    epsilon,
  })

  const isNearVerticalEdge = isNearMinX || isNearMaxX
  const isNearHorizontalEdge = isNearMinY || isNearMaxY
  const isNearCorner = isNearVerticalEdge && isNearHorizontalEdge

  if (isNearCorner) {
    return "on-boundary"
  }

  const isWithinYRange = isWithinRange({
    value: point.y,
    min: bounds.minY,
    max: bounds.maxY,
  })
  const isWithinXRange = isWithinRange({
    value: point.x,
    min: bounds.minX,
    max: bounds.maxX,
  })

  const isOnBoundary =
    (isNearVerticalEdge && isWithinYRange) ||
    (isNearHorizontalEdge && isWithinXRange)

  return isOnBoundary ? "on-boundary" : "inside"
}

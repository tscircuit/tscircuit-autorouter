import {
  doSegmentsIntersect,
  getSegmentIntersection,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

export type PolygonPoint = { x: number; y: number }

const EPSILON = 1e-6

const isPointOnSegment = (
  point: PolygonPoint,
  start: PolygonPoint,
  end: PolygonPoint,
) => pointToSegmentDistance(point, start, end) <= EPSILON

const arePointsClose = (a: PolygonPoint, b: PolygonPoint) =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON

export const isPointInOrOnPolygon = (
  point: PolygonPoint,
  polygon: PolygonPoint[],
) => {
  if (!polygon || polygon.length < 3) {
    return false
  }

  // Treat points on the boundary as inside the polygon
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i]
    const end = polygon[(i + 1) % polygon.length]
    if (isPointOnSegment(point, start, end)) {
      return true
    }
  }

  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]
    const pj = polygon[j]

    const intersect =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x

    if (intersect) {
      inside = !inside
    }
  }

  return inside
}

export const doesSegmentCrossPolygonBoundary = ({
  start,
  end,
  polygon,
  margin = 0.2,
}: {
  start: PolygonPoint
  end: PolygonPoint
  polygon: PolygonPoint[]
  margin?: number
}) => {
  if (!polygon || polygon.length < 3) {
    return false
  }

  const startInside = isPointInOrOnPolygon(start, polygon)
  const endInside = isPointInOrOnPolygon(end, polygon)

  if (!startInside || !endInside) {
    return true
  }

  for (let i = 0; i < polygon.length; i++) {
    const edgeStart = polygon[i]
    const edgeEnd = polygon[(i + 1) % polygon.length]

    const startOnEdge = isPointOnSegment(start, edgeStart, edgeEnd)
    const endOnEdge = isPointOnSegment(end, edgeStart, edgeEnd)

    if (startOnEdge && endOnEdge) {
      // Moving along the outline edge is permitted
      continue
    }

    if (!doSegmentsIntersect(start, end, edgeStart, edgeEnd)) {
      if (!startOnEdge && !endOnEdge) {
        const distanceToEdge = minimumDistanceBetweenSegments(
          start,
          end,
          edgeStart,
          edgeEnd,
        )

        if (distanceToEdge < margin - EPSILON) {
          return true
        }
      }

      continue
    }

    const intersection = getSegmentIntersection(start, end, edgeStart, edgeEnd)

    if (
      intersection &&
      ((startOnEdge && arePointsClose(intersection, start)) ||
        (endOnEdge && arePointsClose(intersection, end)))
    ) {
      // The path only touches the boundary at its start or end point
      continue
    }

    if (
      intersection &&
      (arePointsClose(intersection, start) || arePointsClose(intersection, end))
    ) {
      continue
    }

    return true
  }

  return false
}

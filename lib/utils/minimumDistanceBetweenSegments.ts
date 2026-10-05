interface Point {
  x: number
  y: number
}

import { doSegmentsIntersect } from "@tscircuit/math-utils"

/**
 * Calculates the minimum distance between two line segments.
 * @param A1 First point of the first line segment
 * @param A2 Second point of the first line segment
 * @param B1 First point of the second line segment
 * @param B2 Second point of the second line segment
 * @returns The minimum distance between the two line segments
 */
export function minimumDistanceBetweenSegments(
  A1: Point,
  A2: Point,
  B1: Point,
  B2: Point,
): number {
  // Check if segments intersect
  if (doSegmentsIntersect(A1, A2, B1, B2)) {
    return 0
  }

  // Calculate distances from each endpoint to the other segment
  const distA1 = pointToSegmentDistance(A1, B1, B2)
  const distA2 = pointToSegmentDistance(A2, B1, B2)
  const distB1 = pointToSegmentDistance(B1, A1, A2)
  const distB2 = pointToSegmentDistance(B2, A1, A2)

  // Return the minimum of the four distances
  return Math.min(distA1, distA2, distB1, distB2)
}

/**
 * Calculates the distance from a point to a line segment.
 * @param P The point
 * @param Q1 First point of the line segment
 * @param Q2 Second point of the line segment
 * @returns The minimum distance from point P to the line segment Q1Q2
 */
function pointToSegmentDistance(P: Point, Q1: Point, Q2: Point): number {
  const v = { x: Q2.x - Q1.x, y: Q2.y - Q1.y }
  const w = { x: P.x - Q1.x, y: P.y - Q1.y }

  // Calculate squared length of the segment
  const c1 = dotProduct(w, v)
  if (c1 <= 0) {
    // Point is behind Q1
    return distance(P, Q1)
  }

  const c2 = dotProduct(v, v)
  if (c2 <= c1) {
    // Point is beyond Q2
    return distance(P, Q2)
  }

  // Point projects onto the segment
  const b = c1 / c2
  const Pb = {
    x: Q1.x + b * v.x,
    y: Q1.y + b * v.y,
  }
  return distance(P, Pb)
}

/**
 * Calculates the dot product of two vectors.
 */
function dotProduct(
  v1: { x: number; y: number },
  v2: { x: number; y: number },
): number {
  return v1.x * v2.x + v1.y * v2.y
}

/**
 * Calculates the Euclidean distance between two points.
 */
function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  return Math.sqrt(dx * dx + dy * dy)
}

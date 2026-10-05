import { Point2D } from "./JumperPrepatternSolver2_HyperGraph"

/**
 * Check if two segments are collinear (on the same line).
 * Uses a relative epsilon based on segment lengths to handle floating point imprecision.
 */

export function areSegmentsCollinear(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): boolean {
  // Cross product of vectors (a2-a1) and (b1-a1), and (a2-a1) and (b2-a1)
  // If both are ~0, points b1 and b2 are on the line through a1-a2
  const vx = a2.x - a1.x
  const vy = a2.y - a1.y

  // Calculate segment lengths for relative epsilon
  const lenA = Math.sqrt(vx * vx + vy * vy)
  const lenB = Math.sqrt(
    (b2.x - b1.x) * (b2.x - b1.x) + (b2.y - b1.y) * (b2.y - b1.y),
  )

  // Use a relative epsilon based on segment lengths (0.01 = 1% tolerance)
  // Cross product magnitude is proportional to length * perpendicular distance
  // So we scale epsilon by segment length
  const maxLen = Math.max(lenA, lenB, 1)
  const epsilon = maxLen * 0.01 // 1% of segment length

  const cross1 = vx * (b1.y - a1.y) - vy * (b1.x - a1.x)
  const cross2 = vx * (b2.y - a1.y) - vy * (b2.x - a1.x)

  return Math.abs(cross1) < epsilon && Math.abs(cross2) < epsilon
}

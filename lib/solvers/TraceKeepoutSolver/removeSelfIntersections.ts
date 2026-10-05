import { Jumper } from "lib/types/high-density-types"

interface Point3D {
  x: number
  y: number
  z: number
}

/** Tolerance for comparing floating point coordinates */
const COORD_TOLERANCE = 0.0001

/**
 * Finds the intersection point between two line segments, if it exists.
 * Returns null if the segments don't intersect.
 */
function getSegmentIntersection(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): { x: number; y: number } | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y

  const cross = d1x * d2y - d1y * d2x

  // Parallel lines
  if (Math.abs(cross) < 1e-10) {
    return null
  }

  const dx = p3.x - p1.x
  const dy = p3.y - p1.y

  const t = (dx * d2y - dy * d2x) / cross
  const u = (dx * d1y - dy * d1x) / cross

  // Check if intersection is within both segments (excluding endpoints for self-intersection)
  const epsilon = 1e-6
  if (t > epsilon && t < 1 - epsilon && u > epsilon && u < 1 - epsilon) {
    return {
      x: p1.x + t * d1x,
      y: p1.y + t * d1y,
    }
  }

  return null
}

/**
 * Checks if a point is a jumper endpoint.
 */
function isJumperEndpoint(
  point: { x: number; y: number },
  jumpers: Jumper[] | undefined,
): boolean {
  if (!jumpers || jumpers.length === 0) return false

  for (const jumper of jumpers) {
    if (
      (Math.abs(point.x - jumper.start.x) < COORD_TOLERANCE &&
        Math.abs(point.y - jumper.start.y) < COORD_TOLERANCE) ||
      (Math.abs(point.x - jumper.end.x) < COORD_TOLERANCE &&
        Math.abs(point.y - jumper.end.y) < COORD_TOLERANCE)
    ) {
      return true
    }
  }
  return false
}

/**
 * Checks if a range of indices contains any jumper endpoints.
 */
function rangeContainsJumperEndpoint(
  route: Point3D[],
  startIdx: number,
  endIdx: number,
  jumpers: Jumper[] | undefined,
): boolean {
  if (!jumpers || jumpers.length === 0) return false

  for (let i = startIdx; i <= endIdx; i++) {
    if (i >= 0 && i < route.length && isJumperEndpoint(route[i]!, jumpers)) {
      return true
    }
  }
  return false
}

/**
 * Removes self-intersections from a route by finding where the path crosses itself
 * and creating a shortcut at the intersection point.
 *
 * When a self-intersection is detected, the loop between the two intersecting
 * segments is removed, and a new point is created at the intersection.
 *
 * IMPORTANT: This function will NOT remove loops that contain jumper endpoints,
 * as jumper positions must be preserved exactly.
 */
export function removeSelfIntersections(
  route: Point3D[],
  jumpers?: Jumper[],
): Point3D[] {
  if (route.length < 4) {
    return route
  }

  let result = [...route]
  let foundIntersection = true

  // Keep removing intersections until none are found
  while (foundIntersection) {
    foundIntersection = false

    // Check all pairs of non-adjacent segments
    for (let i = 0; i < result.length - 1 && !foundIntersection; i++) {
      const seg1Start = result[i]!
      const seg1End = result[i + 1]!

      // Skip if segment spans different layers
      if (seg1Start.z !== seg1End.z) {
        continue
      }

      // Start at i + 2 to skip adjacent segments
      for (let j = i + 2; j < result.length - 1 && !foundIntersection; j++) {
        // Skip the segment that shares a point with segment i
        if (j === i + 1) continue

        const seg2Start = result[j]!
        const seg2End = result[j + 1]!

        // Skip if segment spans different layers or is on a different layer
        if (seg2Start.z !== seg2End.z || seg1Start.z !== seg2Start.z) {
          continue
        }

        const intersection = getSegmentIntersection(
          seg1Start,
          seg1End,
          seg2Start,
          seg2End,
        )

        if (intersection) {
          // Found a self-intersection!
          // But first, check if removing this loop would destroy any jumper endpoints.
          // The loop being removed is from index i+1 to index j (inclusive).
          // We need to ensure no jumper endpoints exist in this range.
          if (rangeContainsJumperEndpoint(result, i + 1, j, jumpers)) {
            // Skip this intersection - removing it would destroy a jumper
            continue
          }

          // Create new route: keep points 0 to i, add intersection point, keep points j+1 to end
          const newRoute: Point3D[] = []

          // Add points from start to segment i (inclusive)
          for (let k = 0; k <= i; k++) {
            newRoute.push(result[k]!)
          }

          // Add the intersection point
          newRoute.push({
            x: intersection.x,
            y: intersection.y,
            z: seg1Start.z,
          })

          // Add points from after segment j to end
          for (let k = j + 1; k < result.length; k++) {
            newRoute.push(result[k]!)
          }

          result = newRoute
          foundIntersection = true
        }
      }
    }
  }

  return result
}

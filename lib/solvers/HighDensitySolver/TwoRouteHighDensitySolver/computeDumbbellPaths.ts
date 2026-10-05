import { useState, useRef, useEffect } from "react"
import { distance, pointToSegmentDistance } from "@tscircuit/math-utils"

type Point = { x: number; y: number }
type Segment = { start: Point; end: Point }
type JLine = {
  index: number
  startsAt: "C" | "D"
  goesTo: "A" | "B"
  points: Point[]
}

/**
 * Compute optimal paths for the dumbbell visualization
 * @param {Object} config - Configuration object
 * @param {Object} config.A - Point A coordinates {x, y}
 * @param {Object} config.B - Point B coordinates {x, y}
 * @param {Object} config.C - Point C coordinates {x, y}
 * @param {Object} config.D - Point D coordinates {x, y}
 * @param {Object} config.E - Point E coordinates {x, y}
 * @param {Object} config.F - Point F coordinates {x, y}
 * @param {number} config.radius - Circle radius
 * @param {number} config.margin - Margin around circles
 * @param {number} config.subdivisions - Number of subdivisions (default: 0)
 * @returns {Object} - Result containing jPair and optimalPath
 *
 * https://claude.ai/artifacts/f1f6dbc8-02f9-46be-8dff-7a60709a5011
 */
export function computeDumbbellPaths({
  A,
  B,
  C,
  D,
  E,
  F,
  radius,
  margin,
  subdivisions = 0,
}: {
  A: { x: number; y: number }
  B: { x: number; y: number }
  C: { x: number; y: number }
  D: { x: number; y: number }
  E: { x: number; y: number }
  F: { x: number; y: number }
  radius: number
  margin: number
  subdivisions: number
}): {
  jPair: {
    line1: JLine
    line2: JLine
  } | null
  optimalPath: {
    startsAt: "C" | "D"
    goesTo: "C" | "D"
    points: { x: number; y: number }[]
  }
} {
  // Basic types
  // Point and Segment types are assumed to be defined like this:
  // interface Point { x: number; y: number; }
  // interface Segment { start: Point; end: Point; }

  // Helper functions

  // Calculate midpoint between two points
  const midpoint = (p1: Point, p2: Point): Point => ({
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  })

  // Calculate all dumbbell points
  const calculatePoints = (
    a: Point,
    b: Point,
    r: number,
  ): {
    midpoint: Point
    A_Opp: Point
    A_Right: Point
    A_Left: Point
    B_Opp: Point
    B_Right: Point
    B_Left: Point
  } => {
    // Vector from A to B
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy)

    // Unit vectors
    const ux = dx / len
    const uy = dy / len
    const px = -uy
    const py = ux // Perpendicular unit vector

    return {
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      A_Opp: { x: a.x - ux * r, y: a.y - uy * r },
      A_Right: { x: a.x + px * r, y: a.y + py * r },
      A_Left: { x: a.x - px * r, y: a.y - py * r },
      B_Opp: { x: b.x + ux * r, y: b.y + uy * r },
      B_Right: { x: b.x + px * r, y: b.y + py * r },
      B_Left: { x: b.x - px * r, y: b.y - py * r },
    }
  }

  // Check if a point is on a line segment
  const isPointOnSegment = (point: Point, segment: Segment): boolean => {
    // Calculate distance from point to segment endpoints
    const d1 = distance(point, segment.start)
    const d2 = distance(point, segment.end)
    // Calculate segment length
    const segmentLength = distance(segment.start, segment.end)
    // Allow a small tolerance for floating-point errors
    const tolerance = 0.0001
    // Check if point is on segment (d1 + d2 should approximately equal segmentLength)
    return Math.abs(d1 + d2 - segmentLength) < tolerance
  }

  // Line intersection check
  const intersect = (l1: Segment, l2: Segment): boolean => {
    const { start: p1, end: p2 } = l1
    const { start: p3, end: p4 } = l2

    // Check if any endpoint of one segment is on the other segment
    if (
      isPointOnSegment(p1, l2) ||
      isPointOnSegment(p2, l2) ||
      isPointOnSegment(p3, l1) ||
      isPointOnSegment(p4, l1)
    ) {
      return true
    }

    const d1x = p2.x - p1.x
    const d1y = p2.y - p1.y
    const d2x = p4.x - p3.x
    const d2y = p4.y - p3.y

    const det = d1x * d2y - d1y * d2x
    if (Math.abs(det) < 0.0001) return false // Parallel or collinear

    const dx = p3.x - p1.x
    const dy = p3.y - p1.y
    const t = (dx * d2y - dy * d2x) / det
    const u = (dx * d1y - dy * d1x) / det

    return t > 0 && t < 1 && u > 0 && u < 1
  }

  // Check if path1 intersects with path2
  const doPathsIntersect = (path1: Point[], path2: Point[]): boolean => {
    // Create segments from path1
    const segments1 = []
    for (let i = 0; i < path1.length - 1; i++) {
      segments1.push({ start: path1[i], end: path1[i + 1] })
    }

    // Create segments from path2
    const segments2 = []
    for (let i = 0; i < path2.length - 1; i++) {
      segments2.push({ start: path2[i], end: path2[i + 1] })
    }

    // Check if any segment from path1 intersects with any segment from path2
    for (const seg1 of segments1) {
      for (const seg2 of segments2) {
        if (intersect(seg1, seg2)) {
          return true
        }
      }
    }

    return false
  }

  // Path length calculation
  const pathLength = (points: Point[]): number => {
    let len = 0
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x
      const dy = points[i].y - points[i - 1].y
      len += Math.sqrt(dx * dx + dy * dy)
    }
    return len
  }

  // Find closest point on segment to circle center
  const closestPointOnSegment = (
    segment: Segment,
    circleCenter: Point,
  ): { x: number; y: number; t: number } => {
    const { start, end } = segment
    const dx = end.x - start.x
    const dy = end.y - start.y
    const segmentLengthSquared = dx * dx + dy * dy

    if (segmentLengthSquared === 0) return { ...start, t: 0 } // Segment is a point

    // Calculate projection scalar
    const t = Math.max(
      0,
      Math.min(
        1,
        ((circleCenter.x - start.x) * dx + (circleCenter.y - start.y) * dy) /
          segmentLengthSquared,
      ),
    )

    // Calculate closest point
    return {
      x: start.x + t * dx,
      y: start.y + t * dy,
      t: t, // Keep track of the parameter for later use
    }
  }

  // Find the point at radius distance from circle center, moving away from the closest point
  const getSubdivisionPoint = (
    segment: Segment,
    circleCenter: Point,
    r: number,
  ): {
    x: number
    y: number
    t: number
    isSpecial?: boolean
    specialType?: "A" | "B"
  } => {
    const closestPoint = closestPointOnSegment(segment, circleCenter)

    // Calculate distance from closest point to circle center
    const dist = distance(closestPoint, circleCenter)

    // If distance is greater than radius, no need to adjust
    if (dist >= r) return closestPoint

    // Calculate direction vector from circle center to closest point
    const dirX = closestPoint.x - circleCenter.x
    const dirY = closestPoint.y - circleCenter.y

    // Normalize direction vector
    const norm = Math.sqrt(dirX * dirX + dirY * dirY)
    if (norm === 0) {
      // If closest point is the circle center, use segment direction
      const segDirX = segment.end.x - segment.start.x
      const segDirY = segment.end.y - segment.start.y
      const segNorm = Math.sqrt(segDirX * segDirX + segDirY * segDirY)

      return {
        x: circleCenter.x + (r * segDirX) / segNorm,
        y: circleCenter.y + (r * segDirY) / segNorm,
        t: closestPoint.t,
        isSpecial: true,
        specialType: circleCenter === A ? "A" : "B",
      }
    }

    // Calculate point at radius distance from circle center
    return {
      x: circleCenter.x + (r * dirX) / norm,
      y: circleCenter.y + (r * dirY) / norm,
      t: closestPoint.t,
      isSpecial: true,
      specialType: circleCenter === A ? "A" : "B",
    }
  }

  // Subdivide path based on proximity to A and B
  const subdivideOptimalPath = (
    path: Point[],
    numSubdivisions: number,
  ): Point[] => {
    if (path.length < 2) return path

    const result = [path[0]] // Start with the first point

    // Process each segment
    for (let i = 0; i < path.length - 1; i++) {
      const segment = { start: path[i], end: path[i + 1] }

      // Calculate midpoint of segment
      const segmentMidpoint = {
        x: (segment.start.x + segment.end.x) / 2,
        y: (segment.start.y + segment.end.y) / 2,
      }

      // Check if midpoint is within radius of A or B
      const midpointDistToA = distance(segmentMidpoint, A)
      const midpointDistToB = distance(segmentMidpoint, B)

      // Only subdivide if midpoint is within radius of A or B
      const shouldSubdivide =
        (midpointDistToA <= radius || midpointDistToB <= radius) &&
        Math.abs(midpointDistToA - midpointDistToB) > 0.0001

      if (shouldSubdivide) {
        // Calculate closest points to A and B on this segment
        const closestPointA = closestPointOnSegment(segment, A)
        const closestPointB = closestPointOnSegment(segment, B)

        // Calculate distances
        const distToA = distance(closestPointA, A)
        const distToB = distance(closestPointB, B)

        // Check if we need to create radius points
        const needsRadiusPointA = distToA < radius
        const needsRadiusPointB = distToB < radius

        // Create adjusted points at radius distance if needed
        const adjustedPointA = needsRadiusPointA
          ? getSubdivisionPoint(segment, A, radius)
          : null
        const adjustedPointB = needsRadiusPointB
          ? getSubdivisionPoint(segment, B, radius)
          : null

        // Create regular subdivisions
        let subdivisionPoints = []

        // Only add regular subdivisions if segment isn't too short
        const segmentLength = distance(segment.start, segment.end)
        if (segmentLength > radius / 2 && numSubdivisions > 0) {
          for (let j = 1; j <= numSubdivisions; j++) {
            const t = j / (numSubdivisions + 1)

            // Create the subdivision point
            const subPoint = {
              x: segment.start.x + t * (segment.end.x - segment.start.x),
              y: segment.start.y + t * (segment.end.y - segment.start.y),
              t: t,
              isSpecial: false,
            }

            // Check if this subdivision point is too close to A or B centers
            const subDistToA = distance(subPoint, A)
            const subDistToB = distance(subPoint, B)

            // Skip points that are inside the circles or too close to special points
            if (subDistToA < radius || subDistToB < radius) {
              // Skip this point
              continue
            }

            // Skip if too close to the special points we'll add later
            if (
              adjustedPointA &&
              Math.abs(subPoint.t - adjustedPointA.t) < 0.1
            ) {
              continue
            }

            if (
              adjustedPointB &&
              Math.abs(subPoint.t - adjustedPointB.t) < 0.1
            ) {
              continue
            }

            // This point is good, add it
            subdivisionPoints.push(subPoint)
          }
        }

        // Add the adjusted points if needed
        if (adjustedPointA) {
          subdivisionPoints.push(adjustedPointA)
        }

        if (adjustedPointB) {
          subdivisionPoints.push(adjustedPointB)
        }

        // Sort all points by t parameter (distance along segment)
        subdivisionPoints.sort((a, b) => a.t - b.t)

        // Filter out any duplicate or very close points
        if (subdivisionPoints.length > 1) {
          const filteredPoints = [subdivisionPoints[0]]

          for (let j = 1; j < subdivisionPoints.length; j++) {
            const prev = filteredPoints[filteredPoints.length - 1]
            const curr = subdivisionPoints[j]

            // Only add points that are at least a bit apart
            if (distance(prev, curr) > radius / 10) {
              filteredPoints.push(curr)
            }
          }

          subdivisionPoints = filteredPoints
        }

        // Add all subdivision points to the result
        subdivisionPoints.forEach((p) => result.push(p))
      }

      // Add end point
      result.push(path[i + 1])
    }

    // Filter duplicate or very close consecutive points
    if (result.length > 1) {
      const filteredResult = [result[0]]

      for (let i = 1; i < result.length; i++) {
        const prev = filteredResult[filteredResult.length - 1]
        const curr = result[i]

        // Only add points that are at least a bit apart
        if (distance(prev, curr) > radius / 10) {
          filteredResult.push(curr)
        }
      }

      return filteredResult
    }

    return result
  }

  // Calculate points for inner and outer dumbbells
  const innerPoints = calculatePoints(A, B, radius)
  const outerPoints = calculatePoints(A, B, radius + margin)

  // Define the four S-shape paths
  const getPaths = () => [
    // Path 1: C→B_Left→B_Opp→B_Right→Mid→A_Left→A_Opp→A_Right→D
    [
      C,
      innerPoints.B_Left,
      innerPoints.B_Opp,
      innerPoints.B_Right,
      midpoint(
        innerPoints.midpoint,
        midpoint(innerPoints.B_Right, innerPoints.A_Right),
      ),
      midpoint(
        innerPoints.midpoint,
        midpoint(innerPoints.A_Left, innerPoints.B_Left),
      ),
      innerPoints.A_Left,
      innerPoints.A_Opp,
      innerPoints.A_Right,
      D,
    ],
    // Path 2: C→B_Right→B_Opp→B_Left→Mid→A_Right→A_Opp→A_Left→D
    [
      C,
      innerPoints.B_Right,
      innerPoints.B_Opp,
      innerPoints.B_Left,
      midpoint(
        innerPoints.midpoint,
        midpoint(innerPoints.A_Left, innerPoints.B_Left),
      ),
      midpoint(
        innerPoints.midpoint,
        midpoint(innerPoints.A_Right, innerPoints.B_Right),
      ),
      innerPoints.A_Right,
      innerPoints.A_Opp,
      innerPoints.A_Left,
      D,
    ],
    // Path 3: D→B_Left→B_Opp→B_Right→Mid→A_Left→A_Opp→A_Right→C
    [
      D,
      innerPoints.B_Left,
      innerPoints.B_Opp,
      innerPoints.B_Right,
      midpoint(
        innerPoints.midpoint,
        midpoint(innerPoints.A_Right, innerPoints.B_Right),
      ),
      midpoint(
        innerPoints.midpoint,
        midpoint(innerPoints.A_Left, innerPoints.B_Left),
      ),
      innerPoints.A_Left,
      innerPoints.A_Opp,
      innerPoints.A_Right,
      C,
    ],
    // Path 4: D→B_Right→B_Opp→B_Left→Mid→A_Right→A_Opp→A_Left→C
    [
      D,
      innerPoints.B_Right,
      innerPoints.B_Opp,
      innerPoints.B_Left,
      midpoint(
        innerPoints.midpoint,
        midpoint(innerPoints.A_Left, innerPoints.B_Left),
      ),
      midpoint(
        innerPoints.midpoint,
        midpoint(innerPoints.A_Right, innerPoints.B_Right),
      ),
      innerPoints.A_Right,
      innerPoints.A_Opp,
      innerPoints.A_Left,
      C,
    ],
  ]

  // Define the J-lines
  const getJLines = () => {
    const mid_AR_BR = midpoint(innerPoints.A_Right, innerPoints.B_Right)
    const mid_AL_BL = midpoint(innerPoints.B_Left, innerPoints.A_Left)

    return [
      /*─────────────────────────  Shortest (straight)  ─────────────────────────*/
      { startsAt: "E", goesTo: "B", points: [E, B] },
      { startsAt: "E", goesTo: "A", points: [E, A] },
      { startsAt: "F", goesTo: "B", points: [F, B] },
      { startsAt: "F", goesTo: "A", points: [F, A] },

      /*─────────────────────────  One‑bend variants  ───────────────────────────*/
      // …via the (AR ↔ BR) right‑side midpoint
      { startsAt: "E", goesTo: "B", points: [E, mid_AR_BR, B] },
      { startsAt: "E", goesTo: "A", points: [E, mid_AR_BR, A] },
      { startsAt: "F", goesTo: "B", points: [F, mid_AR_BR, B] },
      { startsAt: "F", goesTo: "A", points: [F, mid_AR_BR, A] },

      // …via the (AL ↔ BL) left‑side midpoint
      { startsAt: "E", goesTo: "B", points: [E, mid_AL_BL, B] },
      { startsAt: "E", goesTo: "A", points: [E, mid_AL_BL, A] },
      { startsAt: "F", goesTo: "B", points: [F, mid_AL_BL, B] },
      { startsAt: "F", goesTo: "A", points: [F, mid_AL_BL, A] },

      /*─────────────────────────  Medium (one outer waypoint)  ─────────────────*/
      // right‑side outer arc
      {
        startsAt: "E",
        goesTo: "B",
        points: [E, outerPoints.A_Right, mid_AR_BR, B],
      },
      {
        startsAt: "F",
        goesTo: "B",
        points: [F, outerPoints.B_Right, mid_AR_BR, B],
      },

      // left‑side outer arc
      {
        startsAt: "E",
        goesTo: "A",
        points: [E, outerPoints.B_Left, mid_AL_BL, A],
      },
      {
        startsAt: "F",
        goesTo: "A",
        points: [F, outerPoints.A_Left, mid_AL_BL, A],
      },

      // criss‑cross outer arc
      {
        startsAt: "E",
        goesTo: "B",
        points: [E, outerPoints.A_Left, mid_AL_BL, B],
      },
      {
        startsAt: "E",
        goesTo: "A",
        points: [E, outerPoints.B_Right, mid_AR_BR, A],
      },

      /*─────────────────────────  Long (two outer waypoints)  ──────────────────*/
      {
        startsAt: "E",
        goesTo: "B",
        points: [E, outerPoints.A_Opp, outerPoints.A_Right, mid_AR_BR, B],
      },
      {
        startsAt: "E",
        goesTo: "A",
        points: [E, outerPoints.B_Opp, outerPoints.B_Left, mid_AL_BL, A],
      },

      {
        startsAt: "F",
        goesTo: "B",
        points: [F, outerPoints.A_Opp, outerPoints.A_Left, mid_AL_BL, B],
      },
      {
        startsAt: "F",
        goesTo: "A",
        points: [F, outerPoints.B_Opp, outerPoints.B_Right, mid_AR_BR, A],
      },
      {
        startsAt: "F",
        goesTo: "A" /* alt‑route  */,
        points: [F, outerPoints.B_Opp, outerPoints.B_Left, mid_AL_BL, A],
      },

      {
        startsAt: "E",
        goesTo: "B",
        points: [E, outerPoints.A_Opp, outerPoints.A_Left, mid_AL_BL, B],
      },
      {
        startsAt: "E",
        goesTo: "A",
        points: [E, outerPoints.B_Opp, outerPoints.B_Right, mid_AR_BR, A],
      },

      /*─────────────────────────  Longest (three outer waypoints)  ─────────────*/
      {
        startsAt: "E",
        goesTo: "B",
        points: [
          E,
          outerPoints.A_Left,
          outerPoints.A_Opp,
          outerPoints.A_Right,
          mid_AR_BR,
          B,
        ],
      },

      {
        startsAt: "E",
        goesTo: "A",
        points: [
          E,
          outerPoints.B_Right,
          outerPoints.B_Opp,
          outerPoints.B_Left,
          mid_AL_BL,
          A,
        ],
      },

      {
        startsAt: "F",
        goesTo: "B",
        points: [
          F,
          outerPoints.A_Right,
          outerPoints.A_Opp,
          outerPoints.A_Left,
          mid_AL_BL,
          B,
        ],
      },

      {
        startsAt: "F",
        goesTo: "A",
        points: [
          F,
          outerPoints.B_Left,
          outerPoints.B_Opp,
          outerPoints.B_Right,
          mid_AR_BR,
          A,
        ],
      },

      {
        startsAt: "F",
        goesTo: "A" /* alt‑route  */,
        points: [
          F,
          outerPoints.B_Right,
          outerPoints.B_Opp,
          outerPoints.B_Left,
          mid_AL_BL,
          A,
        ],
      },

      {
        startsAt: "E",
        goesTo: "B",
        points: [
          E,
          outerPoints.A_Right,
          outerPoints.A_Opp,
          outerPoints.A_Left,
          mid_AL_BL,
          B,
        ],
      },

      {
        startsAt: "E",
        goesTo: "A",
        points: [
          E,
          outerPoints.B_Left,
          outerPoints.B_Opp,
          outerPoints.B_Right,
          mid_AR_BR,
          A,
        ],
      },
    ].map((l, index) => ({ ...l, index }))
  }

  // Subdivide a J-line path if segments are too close to the opposite point (A or B)
  const subdivideJLinePath = (
    jLine: JLine,
    oppositePoint: Point,
    r: number,
    m: number,
    numSubdivisions: number, // Keep consistent with optimal path subdivision
  ): Point[] => {
    const path = jLine.points
    if (path.length < 2) return path

    const minDistThreshold = r + m
    const result: Point[] = [path[0]] // Start with the first point

    for (let i = 0; i < path.length - 1; i++) {
      const segment = { start: path[i], end: path[i + 1] }

      // Calculate the distance from the segment to the opposite point
      const distToOpposite = pointToSegmentDistance(
        oppositePoint,
        segment.start,
        segment.end,
      )

      if (distToOpposite < minDistThreshold) {
        // Segment is too close, need to subdivide/adjust

        // Find the point on the segment closest to the opposite point
        const closestPt = closestPointOnSegment(segment, oppositePoint)

        // Calculate the direction vector from the opposite point to the closest point
        const dirX = closestPt.x - oppositePoint.x
        const dirY = closestPt.y - oppositePoint.y
        const norm = Math.sqrt(dirX * dirX + dirY * dirY)

        let adjustedPoint: Point | null = null
        if (norm > 1e-6) {
          // Calculate the point pushed away to the minimum distance threshold
          adjustedPoint = {
            x: oppositePoint.x + (minDistThreshold * dirX) / norm,
            y: oppositePoint.y + (minDistThreshold * dirY) / norm,
            // We might need 't' if combining with regular subdivisions,
            // but for now, just the adjusted point is needed.
            // t: closestPt.t
          }
        } else {
          // Closest point is the opposite point itself (unlikely for segments, but handle)
          // Push away in the segment's direction
          const segDirX = segment.end.x - segment.start.x
          const segDirY = segment.end.y - segment.start.y
          const segNorm = Math.sqrt(segDirX * segDirX + segDirY * segDirY)
          if (segNorm > 1e-6) {
            adjustedPoint = {
              x: oppositePoint.x + (minDistThreshold * segDirX) / segNorm,
              y: oppositePoint.y + (minDistThreshold * segDirY) / segNorm,
            }
          } else {
            // Segment is a point at the opposite point - keep original? Or push arbitrarily?
            // Let's just keep the start point for now.
            // adjustedPoint = { ...segment.start };
            // Or maybe push radially from opposite point? Needs a defined direction.
            // For simplicity, we'll just add the adjusted point if calculable.
          }
        }

        // Add the adjusted point if it was calculated
        // We need to decide where to insert it. Inserting at the 't' position
        // like in the optimal path subdivision might be complex.
        // A simpler approach for now: insert it between start and end.
        // This might create sharp turns, but ensures clearance.
        if (adjustedPoint) {
          // Check distance to avoid adding points too close to start/end
          if (distance(segment.start, adjustedPoint) > radius / 10) {
            result.push(adjustedPoint)
          }
        }
      }

      // Add the original end point of the segment
      // Ensure no duplicates or very close points are added
      const lastPointInResult = result[result.length - 1]
      if (distance(lastPointInResult, segment.end) > radius / 10) {
        result.push(segment.end)
      }
    }

    // Final filter for close points
    if (result.length > 1) {
      const filteredResult = [result[0]]
      for (let i = 1; i < result.length; i++) {
        if (
          distance(filteredResult[filteredResult.length - 1], result[i]) >
          radius / 10
        ) {
          filteredResult.push(result[i])
        }
      }
      return filteredResult
    }

    return result
  }

  // Find the optimal path based on constraints
  const findOptimalPath = () => {
    const paths = getPaths()
    const validPaths = []

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      const firstSeg = { start: path[0], end: path[1] }
      const lastSeg = {
        start: path[path.length - 2],
        end: path[path.length - 1],
      }
      const midSeg = { start: path[3], end: path[4] }

      // Check constraints
      if (
        !intersect(firstSeg, lastSeg) &&
        !intersect(firstSeg, midSeg) &&
        !intersect(lastSeg, midSeg)
      ) {
        validPaths.push({
          index: i + 1,
          path,
          length: pathLength(path),
        })
      }
    }

    // Return shortest valid path or empty result
    if (validPaths.length === 0) {
      return { index: 0, path: [] }
    }

    const optimalPath = validPaths.sort((a, b) => a.length - b.length)[0]

    // Post-process the optimal path
    const path = [...optimalPath.path] // Create a copy of the path

    // Check if first point is closer to 3rd or 4th point
    const firstPoint = path[0]
    const dist3 = distance(firstPoint, path[2])
    const dist4 = distance(firstPoint, path[3])
    const closerIdx = dist3 < dist4 ? 2 : 3

    if (
      dist3 < distance(firstPoint, path[1]) ||
      dist4 < distance(firstPoint, path[1])
    ) {
      // Remove segments between first point and closer point
      path.splice(1, closerIdx - 1)
    }

    // Check if last point is closer to -3rd or -4th point
    const lastPoint = path[path.length - 1]
    const distM3 = distance(lastPoint, path[path.length - 3])
    const distM4 = distance(lastPoint, path[path.length - 4])
    const closerLastIdx = distM3 < distM4 ? path.length - 3 : path.length - 4

    if (
      distM3 < distance(lastPoint, path[path.length - 2]) ||
      distM4 < distance(lastPoint, path[path.length - 2])
    ) {
      // Remove segments between last point and closer point
      path.splice(closerLastIdx + 1, path.length - closerLastIdx - 2)
    }

    return {
      index: optimalPath.index,
      path,
      startsAt: path[0] === C ? "C" : "D",
      goesTo: path[path.length - 1] === C ? "C" : "D",
    }
  }

  // Find the optimal S-path
  const optimalPath = findOptimalPath()

  // Apply subdivisions if requested
  const subdivided =
    subdivisions > 0
      ? subdivideOptimalPath(optimalPath.path, subdivisions)
      : optimalPath.path

  // Find the J-pair that doesn't intersect with the optimal path and isn't too close to A or B
  const findJPair = (): { line1: JLine; line2: JLine } | null => {
    if (optimalPath.path.length === 0) return null

    const jLines = getJLines()
    const minDistFromAB = radius + margin / 2

    // Separate J-lines into those starting with E and those starting with F
    const eLines = jLines.filter((line) => line.startsAt === "E")
    const fLines = jLines.filter((line) => line.startsAt === "F")

    const nonIntersectingELines: JLine[] = []
    const nonIntersectingFLines: JLine[] = []

    // Check each E J-line for proximity and intersection with optimal path
    for (const jLine of eLines) {
      if (doPathsIntersect(jLine.points, optimalPath.path)) continue
      nonIntersectingELines.push(jLine as JLine)
      break
    }

    // Check each F J-line for proximity and intersection with optimal path
    for (const jLine of fLines) {
      if (doPathsIntersect(jLine.points, optimalPath.path)) continue
      nonIntersectingFLines.push(jLine as JLine)
      break
    }

    // If we don't have at least one E line and one F line, return an empty pair
    if (
      nonIntersectingELines.length === 0 ||
      nonIntersectingFLines.length === 0
    ) {
      return null
    }

    // Return the first non-intersecting E line and F line as the J-pair
    return {
      line1: nonIntersectingELines[0],
      line2: nonIntersectingFLines[0],
    }
  }

  // Find the J-pair
  let jPair = findJPair()

  // If a J-pair was found, check and subdivide its lines if they are too close
  // to the opposite A/B point.
  if (jPair) {
    const oppositePoint1 = jPair.line1.goesTo === "A" ? B : A
    const oppositePoint2 = jPair.line2.goesTo === "A" ? B : A

    const subdividedPoints1 = subdivideJLinePath(
      jPair.line1,
      oppositePoint1,
      radius,
      margin,
      subdivisions, // Use same subdivision count for consistency? Or 0? Let's use 0 for now.
    )

    const subdividedPoints2 = subdivideJLinePath(
      jPair.line2,
      oppositePoint2,
      radius,
      margin,
      subdivisions, // Use same subdivision count for consistency? Or 0? Let's use 0 for now.
    )

    // Update the jPair with the subdivided points
    jPair = {
      line1: { ...jPair.line1, points: subdividedPoints1 },
      line2: { ...jPair.line2, points: subdividedPoints2 },
    }

    // Optional: Re-check intersection between the *new* jPair lines and the optimal path?
    // This could lead to cycles if subdivision causes new intersections.
    // For now, we assume the subdivision primarily pushes points away and doesn't create new intersections.
    // if (doPathsIntersect(jPair.line1.points, optimalPath.path) || doPathsIntersect(jPair.line2.points, optimalPath.path)) {
    //   console.warn("Subdivision of J-lines caused intersection with optimal path.");
    //   // Potentially invalidate jPair here or try alternative J-lines?
    //   // jPair = null;
    // }
  }

  // Return the final result
  return {
    jPair,
    optimalPath: {
      startsAt: optimalPath.startsAt! as "C" | "D",
      goesTo: optimalPath.goesTo! as "C" | "D",
      points: subdivided,
    },
  }
}

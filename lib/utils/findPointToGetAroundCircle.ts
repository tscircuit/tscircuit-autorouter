interface Point {
  x: number
  y: number
}

interface Circle {
  center: Point
  radius: number
}

/**
 * Finds the tangent points and their intersection for the shortest path from C to A
 * that touches the circle Q at points B and D.
 *
 * E is the point where you're guaranteed to be able to get around the circle
 * without intersecting it if you travel from A to E to C
 *
 * @param A First observation point
 * @param C Second observation point
 * @param Q Circle definition with center and radius
 * @returns Object containing points B, D, and E
 */
export function findPointToGetAroundCircle(
  A: Point,
  C: Point,
  Q: Circle,
): { B: Point; D: Point; E: Point } {
  // Compute point B (tangent from C to circle Q)
  const B = computeTangentPoint(C, A, Q.center, Q.radius)

  // Compute point D (tangent from A to circle Q)
  const D = computeTangentPoint(A, C, Q.center, Q.radius)

  // Check if B and D are valid (not too close to C and A respectively)
  const distBC = distance(B, C)
  const distAD = distance(A, D)
  const minDistThreshold = 1e-6

  const BIsValid = distBC > minDistThreshold
  const DIsValid = distAD > minDistThreshold

  // Compute point E using a robust approach
  let E: Point

  if (!BIsValid || !DIsValid) {
    // Fallback: Use the midpoint between A and C but ensure it's outside the circle
    const midAC = {
      x: (A.x + C.x) / 2,
      y: (A.y + C.y) / 2,
    }

    const distFromCenter = distance(midAC, Q.center)
    if (distFromCenter < Q.radius * 1.1) {
      // Too close to circle, move away from center
      const dirFromCenter = {
        x: (midAC.x - Q.center.x) / distFromCenter,
        y: (midAC.y - Q.center.y) / distFromCenter,
      }

      E = {
        x: Q.center.x + dirFromCenter.x * Q.radius * 1.2,
        y: Q.center.y + dirFromCenter.y * Q.radius * 1.2,
      }
    } else {
      // Midpoint is far enough from circle
      E = midAC
    }
  } else {
    // B and D are valid, use midpoint between B and D as a robust solution
    E = {
      x: (B.x + D.x) / 2,
      y: (B.y + D.y) / 2,
    }

    // Check if the midpoint is a reasonable solution
    const distBE = distance(B, E)
    const distDE = distance(D, E)

    if (Math.abs(distBE - distDE) > Math.min(distBE, distDE) * 0.5) {
      // The midpoint is significantly closer to one point than the other
      // Use a weighted average instead
      const distAB = distance(A, B)
      const distCD = distance(C, D)
      const totalDist = distAB + distCD

      if (totalDist > minDistThreshold) {
        // Weight based on distances from A to B and C to D
        const weightB = distCD / totalDist
        const weightD = distAB / totalDist

        E = {
          x: B.x * weightB + D.x * weightD,
          y: B.y * weightB + D.y * weightD,
        }
      }
    }

    // Final safety check: make sure E is outside the circle
    const distEToCenter = distance(E, Q.center)
    if (distEToCenter < Q.radius * 1.05) {
      // E is too close to the circle, adjust it
      const dirFromCenter = {
        x: (E.x - Q.center.x) / distEToCenter,
        y: (E.y - Q.center.y) / distEToCenter,
      }

      E = {
        x: Q.center.x + dirFromCenter.x * Q.radius * 1.2,
        y: Q.center.y + dirFromCenter.y * Q.radius * 1.2,
      }
    }
  }

  return { B, D, E }
}

/**
 * Computes the tangent point from an observation point to a circle
 *
 * @param observationPoint The point from which the tangent is drawn
 * @param referencePoint A reference point that helps determine which side of the circle to choose
 * @param circleCenter The center of the circle
 * @param radius The radius of the circle
 * @returns The tangent point on the circle
 */
function computeTangentPoint(
  observationPoint: Point,
  referencePoint: Point,
  circleCenter: Point,
  radius: number,
): Point {
  // Vector from observation point to circle center
  const CQ = [
    circleCenter.x - observationPoint.x,
    circleCenter.y - observationPoint.y,
  ]
  const CQLength = Math.sqrt(CQ[0] * CQ[0] + CQ[1] * CQ[1])

  // Check if tangent is possible (point is inside or on the circle)
  if (CQLength <= radius) {
    // Instead of returning the observation point, find a point on the circle
    // in the direction away from the circle center
    if (CQLength < 1e-8) {
      // If observation point is at circle center, move in direction of reference point
      const refVec = [
        referencePoint.x - observationPoint.x,
        referencePoint.y - observationPoint.y,
      ]
      const refLength = Math.sqrt(refVec[0] * refVec[0] + refVec[1] * refVec[1])

      if (refLength < 1e-8) {
        // If reference point is also at circle center, use arbitrary direction
        return {
          x: circleCenter.x + radius,
          y: circleCenter.y,
        }
      }

      return {
        x: circleCenter.x + (refVec[0] / refLength) * radius,
        y: circleCenter.y + (refVec[1] / refLength) * radius,
      }
    }

    // Move away from circle center along the same line
    const CQUnit = [CQ[0] / CQLength, CQ[1] / CQLength]
    return {
      x: circleCenter.x - CQUnit[0] * radius,
      y: circleCenter.y - CQUnit[1] * radius,
    }
  }

  // Vector from observation point to reference point (to determine which side of the circle)
  const CR = [
    referencePoint.x - observationPoint.x,
    referencePoint.y - observationPoint.y,
  ]

  // Calculate the distance from observation point to the tangent point
  const d = Math.sqrt(CQLength * CQLength - radius * radius)

  // Normalize CQ to get the unit vector in that direction
  const CQUnit = [CQ[0] / CQLength, CQ[1] / CQLength]

  // Calculate two possible perpendicular unit vectors
  const perp1 = [-CQUnit[1], CQUnit[0]]
  const perp2 = [CQUnit[1], -CQUnit[0]]

  // Choose the perpendicular that forms an angle closer to CR
  const dot1 = CR[0] * perp1[0] + CR[1] * perp1[1]
  const dot2 = CR[0] * perp2[0] + CR[1] * perp2[1]
  const perp = dot1 > dot2 ? perp1 : perp2

  // Calculate the sine and cosine of the angle from CQ to the tangent line
  const sinTheta = radius / CQLength
  const cosTheta = d / CQLength

  // Unit vector in the direction of the tangent point
  const unitToTangent = [
    CQUnit[0] * cosTheta + perp[0] * sinTheta,
    CQUnit[1] * cosTheta + perp[1] * sinTheta,
  ]

  // Calculate the tangent point
  return {
    x: observationPoint.x + d * unitToTangent[0],
    y: observationPoint.y + d * unitToTangent[1],
  }
}

/**
 * Helper function to calculate the Euclidean distance between two points
 */
function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  return Math.sqrt(dx * dx + dy * dy)
}

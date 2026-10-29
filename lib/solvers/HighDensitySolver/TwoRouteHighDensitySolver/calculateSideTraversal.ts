import { BOUNDARY_COORDINATE_TOLERANCE_MM } from "lib/utils/classifyPointInBounds"

interface Point {
  x: number
  y: number
}

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface SidePercentages {
  left: number
  top: number
  right: number
  bottom: number
}

// Keep a small epsilon for dimension and angular floating-point comparisons.
const EPSILON = 1e-9

/**
 * Calculates the percentage of each side traversed when going from point A to point B
 * along the rectangle boundary, following the specified turn direction.
 */
function calculateSegmentTraversal(
  startPoint: Point,
  endPoint: Point,
  bounds: Bounds,
  turnDirection: "cw" | "ccw" = "cw", // Default to clockwise
): SidePercentages {
  const startAngle = pointToAngle(startPoint, bounds)
  const endAngle = pointToAngle(endPoint, bounds)

  // Check if start and end points map to the same angle (within epsilon)
  // Note: This doesn't necessarily mean the points are identical if the bounds are degenerate.
  if (Math.abs(endAngle - startAngle) < EPSILON) {
    // A more robust check might compare the points directly if needed:
    // if (Math.abs(startPoint.x - endPoint.x) < EPSILON && Math.abs(startPoint.y - endPoint.y) < EPSILON)
    return { left: 0, top: 0, right: 0, bottom: 0 } // No significant angular movement
  }

  // Pass raw angles and direction to the main calculation function
  return calculateSidePercentages(startAngle, endAngle, bounds, turnDirection)
}

/**
 * Calculates the total percentage of each side traversed when going sequentially
 * from A to B, and then from B to C along a rectangle boundary.
 */
export function calculateTraversalPercentages(
  A: Point,
  B: Point,
  C: Point,
  bounds: Bounds,
  turnDirection?: "cw" | "ccw",
): SidePercentages {
  // Calculate traversal percentages for the segment A -> B
  const percentagesAB = calculateSegmentTraversal(A, B, bounds, turnDirection)

  // Calculate traversal percentages for the segment B -> C
  const percentagesBC = calculateSegmentTraversal(B, C, bounds, turnDirection)

  // Sum the percentages from both segments
  // Use Math.min to cap at 1.0 in case of tiny floating point overflows
  const totalPercentages: SidePercentages = {
    left: Math.min(1.0, percentagesAB.left + percentagesBC.left),
    top: Math.min(1.0, percentagesAB.top + percentagesBC.top),
    right: Math.min(1.0, percentagesAB.right + percentagesBC.right),
    bottom: Math.min(1.0, percentagesAB.bottom + percentagesBC.bottom),
  }

  // Optional: Clean up near-zero values resulting from floating point inaccuracies
  for (const key in totalPercentages) {
    if (Math.abs(totalPercentages[key as keyof SidePercentages]) < EPSILON) {
      totalPercentages[key as keyof SidePercentages] = 0
    }
  }

  return totalPercentages
}

/**
 * Converts a point on the rectangle boundary to an angle (0 to 2π, clockwise from top-left).
 * Updated to be slightly more robust with epsilon checks.
 */
export function pointToAngle(point: Point, bounds: Bounds): number {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  // Avoid division by zero if width or height is zero
  if (width < EPSILON && height < EPSILON) return 0
  const perimeter = 2 * (width + height)
  if (perimeter < EPSILON) return 0 // Avoid division by zero for degenerate rectangles

  let distance = 0

  // Check sides using epsilon comparisons
  if (
    Math.abs(point.y - bounds.maxY) <= BOUNDARY_COORDINATE_TOLERANCE_MM &&
    point.x >= bounds.minX - BOUNDARY_COORDINATE_TOLERANCE_MM &&
    point.x <= bounds.maxX + BOUNDARY_COORDINATE_TOLERANCE_MM
  ) {
    // Top side (y is maxY)
    // Ensure x is clamped within bounds for distance calculation robustness
    distance = Math.max(0, Math.min(width, point.x - bounds.minX))
  } else if (
    Math.abs(point.x - bounds.maxX) <= BOUNDARY_COORDINATE_TOLERANCE_MM &&
    point.y >= bounds.minY - BOUNDARY_COORDINATE_TOLERANCE_MM &&
    point.y <= bounds.maxY + BOUNDARY_COORDINATE_TOLERANCE_MM
  ) {
    // Right side (x is maxX)
    // Ensure y is clamped within bounds
    distance = width + Math.max(0, Math.min(height, bounds.maxY - point.y))
  } else if (
    Math.abs(point.y - bounds.minY) <= BOUNDARY_COORDINATE_TOLERANCE_MM &&
    point.x >= bounds.minX - BOUNDARY_COORDINATE_TOLERANCE_MM &&
    point.x <= bounds.maxX + BOUNDARY_COORDINATE_TOLERANCE_MM
  ) {
    // Bottom side (y is minY)
    // Ensure x is clamped within bounds
    distance =
      width + height + Math.max(0, Math.min(width, bounds.maxX - point.x))
  } else if (
    Math.abs(point.x - bounds.minX) <= BOUNDARY_COORDINATE_TOLERANCE_MM &&
    point.y >= bounds.minY - BOUNDARY_COORDINATE_TOLERANCE_MM &&
    point.y <= bounds.maxY + BOUNDARY_COORDINATE_TOLERANCE_MM
  ) {
    // Left side (x is minX)
    // Ensure y is clamped within bounds
    distance =
      width +
      height +
      width +
      Math.max(0, Math.min(height, point.y - bounds.minY))
  } else {
    // Point might be slightly off boundary due to precision, try snapping it?
    // Or throw error as before. For now, let's log a warning and try snapping.
    // console.warn(
    //   "Point does not lie exactly on the boundary, attempting to snap.",
    //   { point, bounds },
    // )
    // Simple snap: Find closest side point (more complex logic could be added here)
    // For simplicity, we'll re-call with snapped points if needed, or just throw.
    // Let's stick to the original error for now if it's significantly off.
    throw new Error(
      `Point (${point.x}, ${point.y}) does not lie on the boundary defined by ${JSON.stringify(bounds)}`,
    )
    // Alternative: Add logic here to find the closest point on the boundary and use that.
  }

  // Ensure distance doesn't exceed perimeter due to float issues
  distance = Math.max(0, Math.min(perimeter, distance))

  // Convert distance to angle (0 to 2π)
  // Handle perimeter being zero
  return perimeter > EPSILON ? (distance / perimeter) * (2 * Math.PI) : 0
}

/**
 * Calculate percentages of each side traversed based on start and end angles,
 * respecting the specified turn direction.
 */
function calculateSidePercentages(
  startAngle: number, // Raw angle [0, 2π)
  endAngle: number, // Raw angle [0, 2π)
  bounds: Bounds,
  turnDirection: "cw" | "ccw",
): SidePercentages {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  // Avoid division by zero if width or height is zero
  if (width < EPSILON && height < EPSILON)
    return { left: 0, top: 0, right: 0, bottom: 0 }
  const perimeter = 2 * (width + height)
  if (perimeter < EPSILON) return { left: 0, top: 0, right: 0, bottom: 0 }

  // Define angle ranges for each side (clockwise from top-left = 0)
  // Ensure denominator is non-zero
  const angleTopEnd = (width / perimeter) * (2 * Math.PI)
  const angleRightEnd = ((width + height) / perimeter) * (2 * Math.PI)
  const angleBottomEnd = ((width + width + height) / perimeter) * (2 * Math.PI)
  const angleLeftEnd = 2 * Math.PI // Full circle

  const sides = [
    { name: "top", start: 0, end: angleTopEnd, length: width },
    { name: "right", start: angleTopEnd, end: angleRightEnd, length: height },
    {
      name: "bottom",
      start: angleRightEnd,
      end: angleBottomEnd,
      length: width,
    },
    { name: "left", start: angleBottomEnd, end: angleLeftEnd, length: height }, // Ends at 2PI
  ]

  const result: SidePercentages = { left: 0, top: 0, right: 0, bottom: 0 }

  // Helper to calculate the total angle length of the intersection between
  // a side's angle range [sStart, sEnd) and a traversal range.
  // The traversal range is defined from tStart to tEnd in clockwise direction,
  // potentially wrapping around 2π if wrapsAround is true.
  const calculateTraversalOverlap = (
    sStart: number,
    sEnd: number, // Side range [sStart, sEnd)
    tStart: number,
    tEnd: number, // Traversal range (clockwise)
    wrapsAround: boolean, // Does the traversal range wrap around 2π?
  ): number => {
    // Ensure side range is valid (adjust end slightly if it's 2PI to handle interval logic)
    const effectiveSEnd = sEnd > 2 * Math.PI - EPSILON ? 2 * Math.PI : sEnd
    if (effectiveSEnd <= sStart + EPSILON) return 0

    if (!wrapsAround) {
      // Simple case: traversal is [tStart, tEnd)
      const overlapStart = Math.max(sStart, tStart)
      const overlapEnd = Math.min(effectiveSEnd, tEnd)
      return Math.max(0, overlapEnd - overlapStart)
    } else {
      // Wrap-around case: traversal is [tStart, 2π) U [0, tEnd)
      // Overlap with first part: [tStart, 2π)
      const overlap1Start = Math.max(sStart, tStart)
      const overlap1End = Math.min(effectiveSEnd, 2 * Math.PI)
      const overlap1 = Math.max(0, overlap1End - overlap1Start)

      // Overlap with second part: [0, tEnd)
      const overlap2Start = Math.max(sStart, 0)
      const overlap2End = Math.min(effectiveSEnd, tEnd)
      const overlap2 = Math.max(0, overlap2End - overlap2Start)

      return overlap1 + overlap2
    }
  }

  for (const side of sides) {
    // Use side.end directly for range calculation, helper handles 2PI case
    const sideAngleRange = side.end - side.start
    if (sideAngleRange < EPSILON || side.length < EPSILON) continue

    let traversedAngleOnSide = 0
    if (turnDirection === "cw") {
      // Clockwise: Traverse from startAngle to endAngle
      const wraps = startAngle > endAngle + EPSILON // Check if CW traversal wraps past 2PI
      traversedAngleOnSide = calculateTraversalOverlap(
        side.start,
        side.end,
        startAngle,
        endAngle,
        wraps,
      )
    } else {
      // turnDirection === "ccw"
      // Counter-clockwise: Traverse from startAngle *backwards* to endAngle
      // This is equivalent to traversing clockwise from endAngle to startAngle.
      const wraps = endAngle > startAngle + EPSILON // Check if equivalent CW traversal wraps past 2PI
      traversedAngleOnSide = calculateTraversalOverlap(
        side.start,
        side.end,
        endAngle, // Start of equivalent CW traversal
        startAngle, // End of equivalent CW traversal
        wraps,
      )
    }

    if (traversedAngleOnSide > EPSILON) {
      // Percentage calculation: (traversed angle on side) / (total angle range of side)
      const percentage = traversedAngleOnSide / sideAngleRange
      // Add percentage, ensuring it's non-negative and handles potential division by zero if sideAngleRange is tiny
      result[side.name as keyof SidePercentages] += Math.max(
        0,
        Number.isFinite(percentage) ? percentage : 0,
      )
    }
  }

  // Normalize results slightly in case of FP inaccuracies summing up
  for (const key in result) {
    result[key as keyof SidePercentages] = Math.max(
      0,
      Math.min(1.0, result[key as keyof SidePercentages]),
    )
  }

  return result
}

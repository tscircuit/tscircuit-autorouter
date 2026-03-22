interface Point {
  x: number
  y: number
}

/**
 * Finds the optimal position that is closest to the average of points A, B, and C,
 * while maintaining a minimum distance of radius from each point and staying within bounds.
 *
 * https://claude.ai/artifacts/b61d2619-0d39-45e7-b02b-ebdcb645f07e
 */
export function findClosestPointToABCWithinBounds(
  A: Point,
  B: Point,
  C: Point,
  radius: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
) {
  // Calculate the average point (center of mass)
  const avgPoint = {
    x: (A.x + B.x + C.x) / 3,
    y: (A.y + B.y + C.y) / 3,
  }

  // Function to calculate distance between two points
  const distance = (p1: Point, p2: Point) => {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
  }

  // Function to check if a point satisfies all constraints
  const isValidPoint = (point: Point) => {
    // Check distance constraints
    const distToA = distance(point, A)
    const distToB = distance(point, B)
    const distToC = distance(point, C)

    // Check bounds constraints
    const withinBounds =
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY

    return (
      distToA >= radius &&
      distToB >= radius &&
      distToC >= radius &&
      withinBounds
    )
  }

  // Function to check if a point is on the boundary
  const isOnBoundary = (point: Point) => {
    const epsilon = 1e-6
    return (
      Math.abs(point.x - bounds.minX) < epsilon ||
      Math.abs(point.x - bounds.maxX) < epsilon ||
      Math.abs(point.y - bounds.minY) < epsilon ||
      Math.abs(point.y - bounds.maxY) < epsilon
    )
  }

  // First check if average point satisfies all constraints
  if (isValidPoint(avgPoint)) {
    return avgPoint
  }

  // Next, check all the standard candidates based on circles and intersections
  const pointOnCircle = (center: Point, constraint: Point, r: number) => {
    const vx = center.x - constraint.x
    const vy = center.y - constraint.y
    const dist = Math.sqrt(vx * vx + vy * vy)

    if (dist < 1e-10) {
      return { x: constraint.x + r, y: constraint.y }
    }

    return {
      x: constraint.x + (vx / dist) * r,
      y: constraint.y + (vy / dist) * r,
    }
  }

  const findCircleIntersections = (c1: Point, c2: Point, r: number) => {
    const dx = c2.x - c1.x
    const dy = c2.y - c1.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > 2 * r - 1e-10 || dist < 1e-10) {
      return []
    }

    const a = (dist * dist) / (2 * dist)
    const h = Math.sqrt(Math.max(0, r * r - a * a))

    const midX = c1.x + (dx * a) / dist
    const midY = c1.y + (dy * a) / dist

    const intersection1 = {
      x: midX + (h * dy) / dist,
      y: midY - (h * dx) / dist,
    }

    const intersection2 = {
      x: midX - (h * dy) / dist,
      y: midY + (h * dx) / dist,
    }

    const result = []
    const epsilon = 1e-6

    if (
      Math.abs(distance(intersection1, c1) - r) < epsilon &&
      Math.abs(distance(intersection1, c2) - r) < epsilon
    ) {
      result.push(intersection1)
    }

    if (
      Math.abs(distance(intersection2, c1) - r) < epsilon &&
      Math.abs(distance(intersection2, c2) - r) < epsilon
    ) {
      result.push(intersection2)
    }

    return result
  }

  // Get all standard candidates
  const candidateA = pointOnCircle(avgPoint, A, radius)
  const candidateB = pointOnCircle(avgPoint, B, radius)
  const candidateC = pointOnCircle(avgPoint, C, radius)

  const intersectionsAB = findCircleIntersections(A, B, radius)
  const intersectionsBC = findCircleIntersections(B, C, radius)
  const intersectionsCA = findCircleIntersections(C, A, radius)

  const allCandidates = [
    candidateA,
    candidateB,
    candidateC,
    ...intersectionsAB,
    ...intersectionsBC,
    ...intersectionsCA,
  ]

  // Filter to valid candidates
  const validCandidates = allCandidates.filter(isValidPoint)

  // If we have valid interior candidates, use them
  if (validCandidates.length > 0) {
    // Separate interior and boundary points
    const interiorCandidates = validCandidates.filter((p) => !isOnBoundary(p))

    if (interiorCandidates.length > 0) {
      // Sort by distance to average
      interiorCandidates.sort(
        (a, b) => distance(a, avgPoint) - distance(b, avgPoint),
      )
      return interiorCandidates[0]
    }
  }

  // No valid interior candidates from standard points, now do a grid search
  // We'll do a systematic grid search to find interior points
  const gridStep = 5 // 5px grid
  let bestPoint = null
  let bestDistance = Infinity

  for (let x = bounds.minX + 1; x < bounds.maxX; x += gridStep) {
    for (let y = bounds.minY + 1; y < bounds.maxY; y += gridStep) {
      const point = { x, y }
      if (isValidPoint(point)) {
        const dist = distance(point, avgPoint)
        if (dist < bestDistance) {
          bestDistance = dist
          bestPoint = point
        }
      }
    }
  }

  // If we found a valid interior point in the grid search, return it
  if (bestPoint !== null) {
    return bestPoint
  }

  // If all interior methods failed, check boundary points
  // Sample points along the boundary
  const numSamples = 100 // More samples for better accuracy
  const boundaryPoints: any[] = []

  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples

    // Top edge
    boundaryPoints.push({
      x: bounds.minX + t * (bounds.maxX - bounds.minX),
      y: bounds.minY,
    })

    // Right edge
    boundaryPoints.push({
      x: bounds.maxX,
      y: bounds.minY + t * (bounds.maxY - bounds.minY),
    })

    // Bottom edge
    boundaryPoints.push({
      x: bounds.maxX - t * (bounds.maxX - bounds.minX),
      y: bounds.maxY,
    })

    // Left edge
    boundaryPoints.push({
      x: bounds.minX,
      y: bounds.maxY - t * (bounds.maxY - bounds.minY),
    })
  }

  // Find valid boundary points
  const validBoundaryPoints = boundaryPoints.filter(isValidPoint)

  if (validBoundaryPoints.length > 0) {
    // Sort by distance to average
    validBoundaryPoints.sort(
      (a, b) => distance(a, avgPoint) - distance(b, avgPoint),
    )
    return validBoundaryPoints[0]
  }

  // If we get here, no valid point exists that satisfies all constraints
  // Find the point that minimizes constraint violations
  let minViolation = Infinity
  let leastBadPoint = { x: bounds.minX, y: bounds.minY }

  for (const point of [...allCandidates, ...boundaryPoints]) {
    // Only consider points within bounds
    if (
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY
    ) {
      const violationA = Math.max(0, radius - distance(point, A))
      const violationB = Math.max(0, radius - distance(point, B))
      const violationC = Math.max(0, radius - distance(point, C))

      const totalViolation = violationA + violationB + violationC

      if (totalViolation < minViolation) {
        minViolation = totalViolation
        leastBadPoint = point
      }
    }
  }

  return leastBadPoint
}

import { HighDensityRoute } from "lib/types/high-density-types"

interface Point3D {
  x: number
  y: number
  z: number
}

/**
 * Smooths a route to avoid sudden slope changes within the given smoothDistance.
 * Uses a weighted average approach where nearby points influence each point's position.
 *
 * @param route - Array of 3D points representing the route
 * @param smoothDistance - Maximum distance over which slope changes are smoothed (default: 0.5mm)
 * @param sampleInterval - Interval for resampling the route (default: 0.05mm)
 * @returns Smoothed route with gradual slope transitions
 */
export function smoothRoute(
  route: Point3D[],
  smoothDistance: number = 0.5,
  sampleInterval: number = 0.25,
): Point3D[] {
  if (route.length < 3) return [...route]

  // Step 1: Resample the route at regular intervals
  const resampled = resampleRoute(route, sampleInterval)
  if (resampled.length < 3) return [...route]

  // Step 2: Apply Gaussian smoothing while preserving endpoints and layer transitions
  const smoothed = gaussianSmooth(resampled, smoothDistance)

  // Step 3: Simplify the route to remove redundant points
  return simplifyRoute(smoothed)
}

/**
 * Resamples a route to have evenly spaced points
 */
function resampleRoute(route: Point3D[], interval: number): Point3D[] {
  if (route.length < 2) return [...route]

  const result: Point3D[] = [{ ...route[0]! }]
  let currentDist = 0

  for (let i = 0; i < route.length - 1; i++) {
    const start = route[i]!
    const end = route[i + 1]!

    const dx = end.x - start.x
    const dy = end.y - start.y
    const segmentLength = Math.sqrt(dx * dx + dy * dy)

    if (segmentLength === 0) continue

    // If layer changes, add both points explicitly
    if (start.z !== end.z) {
      result.push({ ...end })
      currentDist = 0
      continue
    }

    const dirX = dx / segmentLength
    const dirY = dy / segmentLength

    let distInSegment = interval - currentDist
    while (distInSegment < segmentLength) {
      result.push({
        x: start.x + dirX * distInSegment,
        y: start.y + dirY * distInSegment,
        z: start.z,
      })
      distInSegment += interval
    }

    currentDist = distInSegment - segmentLength
  }

  // Always add the final point
  const lastPoint = route[route.length - 1]!
  const lastResult = result[result.length - 1]!
  if (lastResult.x !== lastPoint.x || lastResult.y !== lastPoint.y) {
    result.push({ ...lastPoint })
  }

  return result
}

/**
 * Applies Gaussian smoothing to the route
 * Points are smoothed based on distance-weighted average of nearby points
 */
function gaussianSmooth(route: Point3D[], smoothDistance: number): Point3D[] {
  if (route.length < 3) return [...route]

  const result: Point3D[] = []
  const sigma = smoothDistance / 3 // Standard deviation for Gaussian kernel

  for (let i = 0; i < route.length; i++) {
    const current = route[i]!

    // Keep first and last points fixed (endpoints)
    if (i === 0 || i === route.length - 1) {
      result.push({ ...current })
      continue
    }

    // Check for layer transitions - keep these points fixed
    const prev = route[i - 1]!
    const next = route[i + 1]!
    if (current.z !== prev.z || current.z !== next.z) {
      result.push({ ...current })
      continue
    }

    // Calculate weighted average position
    let sumX = 0
    let sumY = 0
    let sumWeight = 0

    // Look at points within the smooth distance
    let cumulativeDistBack = 0
    for (let j = i; j >= 0 && cumulativeDistBack <= smoothDistance; j--) {
      const pt = route[j]!

      // Stop at layer transitions
      if (pt.z !== current.z) break

      const weight = gaussianWeight(cumulativeDistBack, sigma)
      sumX += pt.x * weight
      sumY += pt.y * weight
      sumWeight += weight

      if (j > 0) {
        const prevPt = route[j - 1]!
        cumulativeDistBack += distance(pt, prevPt)
      }
    }

    let cumulativeDistForward = 0
    for (
      let j = i + 1;
      j < route.length && cumulativeDistForward <= smoothDistance;
      j++
    ) {
      const pt = route[j]!

      // Stop at layer transitions
      if (pt.z !== current.z) break

      const prevPt = route[j - 1]!
      cumulativeDistForward += distance(pt, prevPt)

      const weight = gaussianWeight(cumulativeDistForward, sigma)
      sumX += pt.x * weight
      sumY += pt.y * weight
      sumWeight += weight
    }

    if (sumWeight > 0) {
      result.push({
        x: sumX / sumWeight,
        y: sumY / sumWeight,
        z: current.z,
      })
    } else {
      result.push({ ...current })
    }
  }

  return result
}

/**
 * Gaussian kernel weight function
 */
function gaussianWeight(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma))
}

/**
 * Calculate distance between two points
 */
function distance(a: Point3D, b: Point3D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Simplifies the route by removing collinear points
 */
function simplifyRoute(points: Point3D[]): Point3D[] {
  if (points.length <= 2) return points

  const result: Point3D[] = [points[0]!]

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1]!
    const curr = points[i]!
    const next = points[i + 1]!

    // Always keep points where z changes
    if (curr.z !== prev.z || curr.z !== next.z) {
      result.push(curr)
      continue
    }

    // Check if the point is collinear with prev and next
    const dx1 = curr.x - prev.x
    const dy1 = curr.y - prev.y
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y

    // Cross product to check collinearity
    const cross = dx1 * dy2 - dy1 * dx2
    const epsilon = 1e-6

    if (Math.abs(cross) > epsilon) {
      // Not collinear, keep this point
      result.push(curr)
    }
  }

  result.push(points[points.length - 1]!)
  return result
}

/**
 * Smooths all routes in a HighDensityRoute array
 *
 * @param hdRoutes - Array of high density routes to smooth
 * @param smoothDistance - Maximum distance over which slope changes are smoothed (default: 0.5mm)
 * @returns New array of routes with smoothed paths
 */
export function smoothHdRoutes(
  hdRoutes: HighDensityRoute[],
  smoothDistance: number = 0.5,
): HighDensityRoute[] {
  return hdRoutes.map((route) => ({
    ...route,
    route: smoothRoute(route.route, smoothDistance),
  }))
}

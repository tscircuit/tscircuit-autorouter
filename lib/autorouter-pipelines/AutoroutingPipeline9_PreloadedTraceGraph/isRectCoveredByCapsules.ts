import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Pipeline9Bounds } from "./pipeline9FixedRouteCopper"

type Capsule = {
  start: { x: number; y: number }
  end: { x: number; y: number }
  radius: number
}

/** Board-world points in mm (+X right, +Y up). Capsule envelopes are convex:
 * four covered corners certify a covered rectangle. Subdivision also detects
 * coverage by several envelopes without approximating their curved edges. */
export function isRectCoveredByCapsules(
  bounds: Pipeline9Bounds,
  capsules: readonly Capsule[],
): boolean {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
  ]
  if (capsules.some(capsule => corners.every(point =>
    pointToSegmentDistance(point, capsule.start, capsule.end) < capsule.radius - 1e-9,
  ))) return true
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
  if ([...corners, center].some(point => capsules.every(capsule =>
    pointToSegmentDistance(point, capsule.start, capsule.end) >= capsule.radius - 1e-9,
  ))) return false
  if (bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY) {
    if (center.x === bounds.minX || center.x === bounds.maxX) return true
    return isRectCoveredByCapsules({ ...bounds, maxX: center.x }, capsules) &&
      isRectCoveredByCapsules({ ...bounds, minX: center.x }, capsules)
  }
  if (center.y === bounds.minY || center.y === bounds.maxY) return true
  return isRectCoveredByCapsules({ ...bounds, maxY: center.y }, capsules) &&
    isRectCoveredByCapsules({ ...bounds, minY: center.y }, capsules)
}

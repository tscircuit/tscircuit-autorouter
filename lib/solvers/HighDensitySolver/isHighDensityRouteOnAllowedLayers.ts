import type { HighDensityRoute } from "lib/types/high-density-types"

export const isHighDensityRouteOnAllowedLayers = (
  route: HighDensityRoute,
  allowedZ: number[] | undefined = route.allowedZ,
): boolean => {
  if (
    allowedZ === undefined ||
    ("isThroughObstacle" in route && route.isThroughObstacle === true)
  )
    return true
  for (let i = 1; i < route.route.length; i++) {
    const a = route.route[i - 1]!
    const b = route.route[i]!
    // A layer transition at one XY position is a via, not a wire on each
    // intervening layer. Its physical clearance is checked independently.
    if (
      a.toNextSegmentType === "through_obstacle" ||
      (a.x === b.x && a.y === b.y)
    )
      continue
    if (!allowedZ.includes(a.z) || !allowedZ.includes(b.z)) return false
  }
  return true
}

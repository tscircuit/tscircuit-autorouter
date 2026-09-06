import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

/** Validates candidate centerlines against the native HD routing domain. */
export const isPipeline9HighDensityRouteInsideBounds = (
  route: HighDensityRoute,
  bounds: SimpleRouteJson["bounds"],
  layerCount: number,
): boolean => {
  for (let index = 0; index < route.route.length; index++) {
    const point = route.route[index]!
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.z) ||
      point.z < 0 ||
      point.z >= layerCount ||
      point.x < bounds.minX ||
      point.x > bounds.maxX ||
      point.y < bounds.minY ||
      point.y > bounds.maxY
    ) {
      return false
    }
    const next = route.route[index + 1]
    if (
      next &&
      point.z !== next.z &&
      point.toNextSegmentType !== "through_obstacle" &&
      (point.x !== next.x || point.y !== next.y)
    ) {
      return false
    }
  }
  return true
}

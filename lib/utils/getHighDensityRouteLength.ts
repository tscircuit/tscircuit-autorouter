import type { HighDensityRoute } from "lib/types/high-density-types"

/** Planar copper length; layer changes add no via-barrel length. */
export const getHighDensityRouteLength = (route: HighDensityRoute): number => {
  let length = 0
  for (let index = 1; index < route.route.length; index++) {
    const previous = route.route[index - 1]!
    const point = route.route[index]!
    length += Math.hypot(point.x - previous.x, point.y - previous.y)
  }
  return length
}

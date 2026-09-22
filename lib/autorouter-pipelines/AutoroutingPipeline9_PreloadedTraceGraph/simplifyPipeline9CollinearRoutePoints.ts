import type { HighDensityRoute } from "lib/types/high-density-types"

/** Remove redundant grid vertices before the force improver's segment-pair work. */
export const simplifyPipeline9CollinearRoutePoints = (
  hdRoutes: readonly HighDensityRoute[],
): HighDensityRoute[] => hdRoutes.map((hdRoute): HighDensityRoute => {
  const route: HighDensityRoute["route"] = []
  for (const point of hdRoute.route) {
    while (route.length >= 2) {
      const start = route[route.length - 2]!
      const middle = route[route.length - 1]!
      if (
        start.z !== middle.z || middle.z !== point.z ||
        start.toNextSegmentType || start.traceThickness !== undefined ||
        Object.keys(middle).some((key) => key !== "x" && key !== "y" && key !== "z") ||
        hdRoute.vias.some((via) => Math.hypot(via.x - middle.x, via.y - middle.y) < 1e-9)
      ) break
      const dx1 = middle.x - start.x
      const dy1 = middle.y - start.y
      const dx2 = point.x - middle.x
      const dy2 = point.y - middle.y
      const length = Math.hypot(point.x - start.x, point.y - start.y)
      // Keep reversals and bends; allow only floating-point noise on a line.
      if (
        length === 0 || dx1 * dx2 + dy1 * dy2 < 0 ||
        Math.abs(dx1 * dy2 - dy1 * dx2) > length * 1e-9
      ) break
      route.pop()
    }
    route.push(point)
  }
  return { ...hdRoute, route }
})

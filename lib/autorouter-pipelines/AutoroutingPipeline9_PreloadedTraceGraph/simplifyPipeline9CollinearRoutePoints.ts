import type { HighDensityRoute } from "lib/types/high-density-types"

// Short collinear runs still provide useful force-improvement control points.
// Only collapse the long oversampled straight runs emitted by grid routing.
const MIN_COLLINEAR_GRID_SEGMENTS = 64
const MIN_FORCE_REGION_POINT_COUNT = 4_096

/** Reduce dense grid runs while preserving ordinary force-improvement vertices. */
export const simplifyPipeline9CollinearRoutePoints = (
  hdRoutes: readonly HighDensityRoute[],
): HighDensityRoute[] => {
  // Force updates depend on the control vertices even when the copper is
  // collinear. Restrict this approximation to pathological grid-heavy regions,
  // where thousands of points make segment-pair processing impractical.
  const pointCountByRegion = new Map<string, number>()
  for (const route of hdRoutes) {
    if (!route.regionId) continue
    pointCountByRegion.set(
      route.regionId,
      (pointCountByRegion.get(route.regionId) ?? 0) + route.route.length,
    )
  }
  return hdRoutes.map((hdRoute): HighDensityRoute => {
    if (
      !hdRoute.regionId ||
      pointCountByRegion.get(hdRoute.regionId)! < MIN_FORCE_REGION_POINT_COUNT
    )
      return hdRoute
    const route: HighDensityRoute["route"] = []
    const routeIndices: number[] = []
    for (const [index, point] of hdRoute.route.entries()) {
      while (route.length >= 2) {
        const start = route[route.length - 2]!
        const middle = route[route.length - 1]!
        if (
          start.z !== middle.z ||
          middle.z !== point.z ||
          start.toNextSegmentType ||
          start.traceThickness !== undefined ||
          Object.keys(middle).some(
            (key) => key !== "x" && key !== "y" && key !== "z",
          ) ||
          hdRoute.vias.some(
            (via) => Math.hypot(via.x - middle.x, via.y - middle.y) < 1e-9,
          )
        )
          break
        const dx1 = middle.x - start.x
        const dy1 = middle.y - start.y
        const dx2 = point.x - middle.x
        const dy2 = point.y - middle.y
        const length = Math.hypot(point.x - start.x, point.y - start.y)
        // Keep reversals and bends; allow only floating-point noise on a line.
        if (
          length === 0 ||
          dx1 * dx2 + dy1 * dy2 < 0 ||
          Math.abs(dx1 * dy2 - dy1 * dx2) > length * 1e-9
        )
          break
        route.pop()
        routeIndices.pop()
      }
      route.push(point)
      routeIndices.push(index)
    }
    const retainedRoute: HighDensityRoute["route"] = []
    for (let i = 0; i < route.length; i++) {
      const point = route[i]!
      const previous = route[i - 1]
      if (previous) {
        const start = routeIndices[i - 1]!
        const end = routeIndices[i]!
        if (end - start < MIN_COLLINEAR_GRID_SEGMENTS) {
          retainedRoute.push(...hdRoute.route.slice(start + 1, end))
        }
      }
      retainedRoute.push(point)
    }
    return { ...hdRoute, route: retainedRoute }
  })
}

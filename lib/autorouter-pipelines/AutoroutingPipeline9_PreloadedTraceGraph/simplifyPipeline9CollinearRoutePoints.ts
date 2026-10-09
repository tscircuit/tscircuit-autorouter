import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"

// Keep legacy callers unchanged unless a region is pathologically large.
const MIN_COLLINEAR_GRID_SEGMENTS = 64
const MIN_FORCE_REGION_POINT_COUNT = 4_096

/** Reduce dense grid runs while preserving ordinary force-improvement vertices. */
export const simplifyPipeline9CollinearRoutePoints = (
  hdRoutes: readonly HighDensityRoute[],
  nodeWithPortPoints: readonly NodeWithPortPoints[] = [],
): HighDensityRoute[] => {
  // Force updates depend on collinear control vertices. Only compact regions
  // large enough to make segment-pair processing impractical; node geometry
  // lets those regions retain control points at trace-width intervals.
  const pointCountByRegion = new Map<CapacityMeshNodeId, number>()
  for (const route of hdRoutes) {
    if (!route.regionId) continue
    pointCountByRegion.set(
      route.regionId,
      (pointCountByRegion.get(route.regionId) ?? 0) + route.route.length,
    )
  }
  const nodeById = new Map<CapacityMeshNodeId, NodeWithPortPoints>(
    nodeWithPortPoints.map((node) => [node.capacityMeshNodeId, node]),
  )
  return hdRoutes.map((hdRoute): HighDensityRoute => {
    const node = hdRoute.regionId ? nodeById.get(hdRoute.regionId) : undefined
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
            (key) =>
              key !== "x" &&
              key !== "y" &&
              key !== "z" &&
              key !== "connectionName" &&
              key !== "rootConnectionName",
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
        if (node !== undefined) {
          let lastRetainedPoint = hdRoute.route[start]!
          for (let pointIndex = start + 1; pointIndex < end; pointIndex++) {
            const candidate = hdRoute.route[pointIndex]!
            if (
              Math.hypot(
                candidate.x - lastRetainedPoint.x,
                candidate.y - lastRetainedPoint.y,
              ) < hdRoute.traceThickness
            ) {
              continue
            }
            retainedRoute.push(candidate)
            lastRetainedPoint = candidate
          }
        } else if (end - start < MIN_COLLINEAR_GRID_SEGMENTS) {
          retainedRoute.push(...hdRoute.route.slice(start + 1, end))
        }
      }
      retainedRoute.push(point)
    }
    return { ...hdRoute, route: retainedRoute }
  })
}

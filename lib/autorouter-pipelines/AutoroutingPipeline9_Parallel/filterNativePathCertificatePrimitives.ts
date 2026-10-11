// Filter readset adapted from the pinned @tscircuit/trace-simplification-solver
// SingleSimplifiedPathSolver5. The actual owner still constructs its Native
// child and publishes through the original Native getter and index sites.
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import type { ParallelPathFilterParams, ParallelPathFilteredPrimitives } from "./ParallelPathQueryCertifier"

/** Internal default-policy certificate preparation; not an admission gate. */
export function filterNativePathCertificatePrimitives(params: ParallelPathFilterParams): ParallelPathFilteredPrimitives {
  const inputRoute = params.inputRoute
  const filteredObstaclePathSegments: ParallelPathFilteredPrimitives["filteredObstaclePathSegments"] = []
  const filteredVias: ParallelPathFilteredPrimitives["filteredVias"] = []
  if (inputRoute.route.length <= 1) return { filteredObstaclePathSegments, filteredVias }
  const bounds = inputRoute.route.reduce((acc, point) => {
    acc.minX = Math.min(acc.minX, point.x)
    acc.maxX = Math.max(acc.maxX, point.x)
    acc.minY = Math.min(acc.minY, point.y)
    acc.maxY = Math.max(acc.maxY, point.y)
    return acc
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
  const isSameNetRoute = (otherRoute: ParallelPathFilterParams["inputRoute"]): boolean => {
    const inputRouteIds = [inputRoute.connectionName, inputRoute.rootConnectionName]
      .filter((id): id is string => id !== undefined)
    const otherRouteIds = [otherRoute.connectionName, otherRoute.rootConnectionName]
      .filter((id): id is string => id !== undefined)
    return inputRouteIds.some((inputRouteId) => otherRouteIds.some((otherRouteId) =>
      inputRouteId === otherRouteId || params.connMap.areIdsConnected(inputRouteId, otherRouteId)))
  }
  // Keep the two Native candidate passes, including each pass's net queries.
  // Segment arrays retain the exact source point identities and candidate order.
  for (const hdRoute of params.otherHdRoutes) {
    if (isSameNetRoute(hdRoute)) continue
    const route = hdRoute.route
    for (let i = 0; i < route.length - 1; i++) {
      const start = route[i]!
      const end = route[i + 1]!
      if (segmentToBoundsMinDistance(start, end, bounds) <= 0.1 + 0.15) {
        filteredObstaclePathSegments.push([start, end])
      }
    }
  }
  for (const hdRoute of params.otherHdRoutes) {
    if (isSameNetRoute(hdRoute)) continue
    for (const via of hdRoute.vias) {
      const margin = 0.1 + 0.15 / 2 + hdRoute.viaDiameter / 2
      const minX = via.x - margin
      const maxX = via.x + margin
      const minY = via.y - margin
      const maxY = via.y + margin
      if (minX <= bounds.maxX && maxX >= bounds.minX && minY <= bounds.maxY && maxY >= bounds.minY) {
        filteredVias.push({ ...via, diameter: hdRoute.viaDiameter })
      }
    }
  }
  return { filteredObstaclePathSegments, filteredVias }
}

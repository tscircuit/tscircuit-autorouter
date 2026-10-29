import type { HighDensityRoute } from "lib/types/high-density-types"

/** Region interpolation copies segment metadata, but approach anchors are points. */
export const removeCopiedPipeline9TerminalApproaches = (
  originalRoutes: HighDensityRoute[],
  mergedRoutes: HighDensityRoute[],
): HighDensityRoute[] => {
  let cleanedRoutes = mergedRoutes
  for (const [routeIndex, route] of mergedRoutes.entries()) {
    if (!route.route.some((point) => point.terminalApproach !== undefined)) {
      continue
    }
    const originalApproaches = originalRoutes[routeIndex]!.route.filter(
      (point) => point.terminalApproach !== undefined,
    )
    let cleanedPoints = route.route
    for (const [pointIndex, point] of route.route.entries()) {
      if (
        point.terminalApproach === undefined ||
        originalApproaches.some(
          (original) =>
            original.terminalApproach === point.terminalApproach &&
            original.x === point.x &&
            original.y === point.y &&
            original.z === point.z,
        )
      ) {
        continue
      }
      if (cleanedPoints === route.route) cleanedPoints = [...route.route]
      const cleanedPoint = { ...point }
      delete cleanedPoint.terminalApproach
      cleanedPoints[pointIndex] = cleanedPoint
    }
    if (cleanedPoints === route.route) continue
    if (cleanedRoutes === mergedRoutes) cleanedRoutes = [...mergedRoutes]
    cleanedRoutes[routeIndex] = { ...route, route: cleanedPoints }
  }
  return cleanedRoutes
}

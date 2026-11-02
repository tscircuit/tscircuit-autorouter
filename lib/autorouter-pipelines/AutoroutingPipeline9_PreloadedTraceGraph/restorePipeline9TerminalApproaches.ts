import type { HighDensityRoute } from "lib/types/high-density-types"

/** Restore internal approach anchors before evaluating a force-refined candidate. */
export const restorePipeline9TerminalApproaches = (
  originalRoutes: HighDensityRoute[],
  proposedRoutes: HighDensityRoute[],
): HighDensityRoute[] | undefined => {
  if (originalRoutes === proposedRoutes) return proposedRoutes
  let restoredRoutes = proposedRoutes
  for (const [routeIndex, originalRoute] of originalRoutes.entries()) {
    const approaches = originalRoute.route.filter(
      (point) => point.terminalApproach !== undefined,
    )
    if (approaches.length === 0) continue
    const proposedRoute = proposedRoutes[routeIndex]!
    const restoredPoints = [...proposedRoute.route]
    for (const approach of approaches) {
      const matches = proposedRoute.route.flatMap((point, pointIndex) =>
        point.terminalApproach === approach.terminalApproach
          ? [pointIndex]
          : [],
      )
      // A force detour may copy a point's metadata. Such a candidate cannot
      // unambiguously preserve this anchor and must not be published.
      if (matches.length !== 1) return undefined
      restoredPoints[matches[0]!] = approach
    }
    if (restoredRoutes === proposedRoutes) restoredRoutes = [...proposedRoutes]
    restoredRoutes[routeIndex] = { ...proposedRoute, route: restoredPoints }
  }
  return restoredRoutes
}

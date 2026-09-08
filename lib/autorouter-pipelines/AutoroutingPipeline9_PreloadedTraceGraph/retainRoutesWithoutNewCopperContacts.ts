import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "./pipeline9FixedRouteCopper"

/** Retains safe force adjustments without introducing new contacting net pairs. */
export const retainRoutesWithoutNewCopperContacts = ({
  originalRoutes,
  candidateRoutes,
  connMap,
}: {
  originalRoutes: HighDensityRoute[]
  candidateRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
}): HighDensityRoute[] => {
  if (originalRoutes.length !== candidateRoutes.length) {
    throw new Error("Force improvement must preserve route count")
  }
  const routes = [...candidateRoutes]
  let restoredRoute = true
  while (restoredRoute) {
    restoredRoute = false
    for (let leftIndex = 0; leftIndex < routes.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < routes.length;
        rightIndex++
      ) {
        const left = routes[leftIndex]!
        const right = routes[rightIndex]!
        const originalLeft = originalRoutes[leftIndex]!
        const originalRight = originalRoutes[rightIndex]!
        if (left === originalLeft && right === originalRight) continue
        if (arePipeline9RoutesOnSameNet(left, right, connMap)) continue
        if (
          !doPipeline9RoutesHaveCopperConflict({ left, right, clearance: 0 })
        ) {
          continue
        }
        if (
          doPipeline9RoutesHaveCopperConflict({
            left: originalLeft,
            right: originalRight,
            clearance: 0,
          })
        ) {
          continue
        }
        // Restoring one pair can expose a conflict with another adjusted route.
        // Each repeat restores at least one route, so this reaches a fixed point.
        routes[leftIndex] = originalLeft
        routes[rightIndex] = originalRight
        restoredRoute = true
      }
    }
  }
  return routes
}

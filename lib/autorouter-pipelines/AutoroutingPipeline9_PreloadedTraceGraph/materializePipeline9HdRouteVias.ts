import type { HighDensityRoute } from "lib/types/high-density-types"
import { getPipeline9LayerTransitionViaEndpoint } from "./getPipeline9LayerTransitionViaEndpoint"

/**
 * Canonicalizes Pipeline9 layer transitions before force improvement.
 *
 * Route x/y coordinates are board-world millimeters and z is the zero-based
 * copper-layer index. Some Pipeline9 high-density solvers encode a transition
 * as a diagonal segment whose explicit via is located at either endpoint. The
 * force improver only preserves vias represented by co-located route points,
 * so this materializes that endpoint without changing the routed copper.
 */
export const materializePipeline9HdRouteVias = (
  hdRoutes: readonly HighDensityRoute[],
): HighDensityRoute[] => {
  return hdRoutes.map((hdRoute) => {
    const route: HighDensityRoute["route"] = []

    for (const routePoint of hdRoute.route) {
      const previousRoutePoint = route.at(-1)
      if (
        !previousRoutePoint ||
        previousRoutePoint.z === routePoint.z ||
        previousRoutePoint.toNextSegmentType === "through_obstacle"
      ) {
        route.push(routePoint)
        continue
      }

      const viaEndpoint = getPipeline9LayerTransitionViaEndpoint({
        hdRoute,
        start: previousRoutePoint,
        end: routePoint,
      })
      if (viaEndpoint === "colocated") {
        route.push(routePoint)
        continue
      }
      if (viaEndpoint === "start") {
        route.push({
          x: previousRoutePoint.x,
          y: previousRoutePoint.y,
          z: routePoint.z,
        })
      } else {
        route.push({
          x: routePoint.x,
          y: routePoint.y,
          z: previousRoutePoint.z,
        })
      }
      route.push(routePoint)
    }

    return { ...hdRoute, route }
  })
}

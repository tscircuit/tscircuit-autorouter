import type { HighDensityRoute } from "lib/types/high-density-types"

const POSITION_EPSILON = 1e-6

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

      const transitionIsColocated =
        Math.abs(previousRoutePoint.x - routePoint.x) <= POSITION_EPSILON &&
        Math.abs(previousRoutePoint.y - routePoint.y) <= POSITION_EPSILON
      const hasViaAtPreviousPoint = hdRoute.vias.some(
        (via) =>
          Math.abs(via.x - previousRoutePoint.x) <= POSITION_EPSILON &&
          Math.abs(via.y - previousRoutePoint.y) <= POSITION_EPSILON,
      )
      const hasViaAtRoutePoint = hdRoute.vias.some(
        (via) =>
          Math.abs(via.x - routePoint.x) <= POSITION_EPSILON &&
          Math.abs(via.y - routePoint.y) <= POSITION_EPSILON,
      )

      if (transitionIsColocated) {
        route.push(routePoint)
        continue
      }
      if (!hasViaAtPreviousPoint && !hasViaAtRoutePoint) {
        throw new Error(
          `Pipeline9 route "${hdRoute.connectionName}" changes layers from z=${previousRoutePoint.z} to z=${routePoint.z} without an explicit via`,
        )
      }
      if (hasViaAtPreviousPoint === hasViaAtRoutePoint) {
        throw new Error(
          `Pipeline9 route "${hdRoute.connectionName}" has an ambiguous layer transition between (${previousRoutePoint.x}, ${previousRoutePoint.y}) and (${routePoint.x}, ${routePoint.y})`,
        )
      }
      if (hasViaAtPreviousPoint) {
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

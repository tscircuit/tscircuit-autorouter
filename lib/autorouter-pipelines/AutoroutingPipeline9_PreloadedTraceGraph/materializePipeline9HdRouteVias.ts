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
  referenceHdRoutes: readonly HighDensityRoute[] = [],
): HighDensityRoute[] => {
  const references = new Map<string, HighDensityRoute[]>()
  for (const reference of referenceHdRoutes) {
    const group = references.get(reference.connectionName)
    if (group) group.push(reference)
    else references.set(reference.connectionName, [reference])
  }
  return hdRoutes.map((hdRoute) => {
    const route: HighDensityRoute["route"] = []
    const vias = [...hdRoute.vias]

    // A path cleanup can omit the via list while retaining its Z change. Only
    // restore an exact site with the same transition layers from the preceding
    // accepted phase. Missing or ambiguous ownership still fails below.
    for (let index = 1; index < hdRoute.route.length; index++) {
      const start = hdRoute.route[index - 1]!
      const end = hdRoute.route[index]!
      if (start.z === end.z || start.toNextSegmentType === "through_obstacle")
        continue
      if (
        vias.some(
          (via): boolean =>
            (via.x === start.x && via.y === start.y) ||
            (via.x === end.x && via.y === end.y),
        )
      )
        continue
      for (const reference of references.get(hdRoute.connectionName) ?? []) {
        if (
          reference.rootConnectionName !== hdRoute.rootConnectionName ||
          reference.viaDiameter !== hdRoute.viaDiameter
        )
          continue
        for (
          let pointIndex = 1;
          pointIndex < reference.route.length;
          pointIndex++
        ) {
          const previous = reference.route[pointIndex - 1]!
          const next = reference.route[pointIndex]!
          if (previous.x !== next.x || previous.y !== next.y) continue
          if (
            !(
              (previous.z === start.z && next.z === end.z) ||
              (previous.z === end.z && next.z === start.z)
            )
          )
            continue
          if (
            !(
              (previous.x === start.x && previous.y === start.y) ||
              (previous.x === end.x && previous.y === end.y)
            )
          )
            continue
          const registered = reference.vias.find(
            (via): boolean => via.x === previous.x && via.y === previous.y,
          )
          if (
            !registered ||
            vias.some(
              (via): boolean =>
                via.x === registered.x && via.y === registered.y,
            )
          )
            continue
          vias.push({ ...registered })
        }
      }
    }
    const ownedRoute = { ...hdRoute, vias }

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
        hdRoute: ownedRoute,
        start: previousRoutePoint,
        end: routePoint,
      })
      if (viaEndpoint === "colocated") {
        route.push(routePoint)
        continue
      }
      const segmentWidth =
        previousRoutePoint.traceThickness !== undefined ||
        routePoint.traceThickness !== undefined
          ? {
              traceThickness: Math.max(
                previousRoutePoint.traceThickness ?? hdRoute.traceThickness,
                routePoint.traceThickness ?? hdRoute.traceThickness,
              ),
            }
          : {}
      if (viaEndpoint === "start") {
        route.push({
          x: previousRoutePoint.x,
          y: previousRoutePoint.y,
          z: routePoint.z,
          ...segmentWidth,
        })
      } else {
        route.push({
          x: routePoint.x,
          y: routePoint.y,
          z: previousRoutePoint.z,
          ...segmentWidth,
        })
      }
      route.push(routePoint)
    }

    return { ...ownedRoute, route }
  })
}

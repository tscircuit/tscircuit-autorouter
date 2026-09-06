import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import {
  arePipeline9RoutesOnSameNet,
  getPipeline9RouteCopperGeometry,
} from "./pipeline9FixedRouteCopper"

type RoutePoint = HighDensityRoute["route"][number]

/** Neither end of a raw/rounded handoff may detach from immutable copper. */
export const doesPipeline9SeamTouchSameNetCopper = ({
  route,
  seamStart,
  seamEnd,
  immutableRoutes,
  connMap,
}: {
  route: HighDensityRoute
  seamStart: RoutePoint
  seamEnd: RoutePoint
  immutableRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
}): boolean => {
  return immutableRoutes.some((immutableRoute) => {
    if (!arePipeline9RoutesOnSameNet(route, immutableRoute, connMap)) {
      return false
    }
    const geometry = getPipeline9RouteCopperGeometry(immutableRoute)
    return (
      geometry.wireSegments.some(
        (segment) =>
          segment.z === seamStart.z &&
          minimumDistanceBetweenSegments(
            seamStart,
            seamEnd,
            segment.start,
            segment.end,
          ) <=
            segment.width / 2 + route.traceThickness / 2,
      ) ||
      geometry.viaSpans.some(
        (via) =>
          seamStart.z >= via.minZ &&
          seamStart.z <= via.maxZ &&
          minimumDistanceBetweenSegments(
            seamStart,
            seamEnd,
            via.center,
            via.center,
          ) <=
            via.diameter / 2 + route.traceThickness / 2,
      )
    )
  })
}

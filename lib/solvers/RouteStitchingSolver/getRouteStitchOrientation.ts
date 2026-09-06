import { distance, type Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  comparePoints,
  compareRoutes,
  DISTANCE_TIE_TOLERANCE,
} from "./routeStitchingShared"

export type RouteStitchOrientation = "start-to-end" | "end-to-start"

export const getRouteStitchOrientation = (params: {
  hdRoutes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
}): {
  firstRoute: HighDensityIntraNodeRoute
  orientation: RouteStitchOrientation
} => {
  const canonicalHdRoutes = [...params.hdRoutes].sort(compareRoutes)
  let firstRoute = canonicalHdRoutes[0]
  if (!firstRoute) {
    throw new Error("Route stitching orientation requires a physical fragment")
  }
  let bestDist = Infinity
  let orientation: RouteStitchOrientation = "start-to-end"
  for (const route of canonicalHdRoutes) {
    const firstPoint = route.route[0]!
    const lastPoint = route.route[route.route.length - 1]!
    const distStartToFirst = distance(params.start, firstPoint)
    const distStartToLast = distance(params.start, lastPoint)
    const distEndToFirst = distance(params.end, firstPoint)
    const distEndToLast = distance(params.end, lastPoint)
    const minDist = Math.min(
      distStartToFirst,
      distStartToLast,
      distEndToFirst,
      distEndToLast,
    )
    if (
      minDist < bestDist - DISTANCE_TIE_TOLERANCE ||
      (Math.abs(minDist - bestDist) <= DISTANCE_TIE_TOLERANCE &&
        compareRoutes(route, firstRoute) < 0)
    ) {
      bestDist = minDist
      firstRoute = route
      if (
        Math.min(distEndToFirst, distEndToLast) <
          Math.min(distStartToFirst, distStartToLast) - DISTANCE_TIE_TOLERANCE ||
        (Math.abs(
          Math.min(distEndToFirst, distEndToLast) -
            Math.min(distStartToFirst, distStartToLast),
        ) <= DISTANCE_TIE_TOLERANCE &&
          comparePoints(params.end, params.start) < 0)
      ) {
        orientation = "end-to-start"
      } else {
        orientation = "start-to-end"
      }
    }
  }
  return { firstRoute, orientation }
}

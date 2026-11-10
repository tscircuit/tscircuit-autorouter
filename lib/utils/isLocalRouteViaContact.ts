import type { HighDensityRoute } from "lib/types/high-density-types"

/** A via pad overlaps its contiguous wire approach inside the contact region. */
export const isLocalRouteViaContact = (
  route: HighDensityRoute,
  via: { x: number; y: number },
  segmentStartIndex: number,
  contactRadius: number,
): boolean => {
  return route.route.some((point, viaIndex): boolean => {
    if (Math.hypot(point.x - via.x, point.y - via.y) > 1e-8) return false
    return [segmentStartIndex, segmentStartIndex + 1].some(
      (endpointIndex): boolean =>
        route.route
          .slice(
            Math.min(viaIndex, endpointIndex),
            Math.max(viaIndex, endpointIndex) + 1,
          )
          .every(
            (approach): boolean =>
              Math.hypot(approach.x - via.x, approach.y - via.y) <=
              contactRadius,
          ),
    )
  })
}

import type { Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

/**
 * Tie tolerance used when the stitch solver chooses between equally good
 * geometric candidates. Keeping this shared makes route selection stable.
 */
export const DISTANCE_TIE_TOLERANCE = 1e-9

/**
 * Maximum same-layer gap that can be bridged while stitching route islands.
 */
export const MAX_STITCH_GAP_DISTANCE_3 = 1

/**
 * Maximum distance allowed when snapping an island endpoint to a real terminal.
 */
export const MAX_TERMINAL_STITCH_GAP_DISTANCE_3 = 1.25

export const compareNumbers = (a: number, b: number) => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Provides a deterministic ordering for 3D points so tie-breaking does not
 * depend on input array order.
 */
export const comparePoints = (a: Point3, b: Point3) =>
  compareNumbers(a.z, b.z) ||
  compareNumbers(a.x, b.x) ||
  compareNumbers(a.y, b.y)

export const getPoint3Key = (point: Point3) =>
  `${point.z.toFixed(6)}:${point.x.toFixed(6)}:${point.y.toFixed(6)}`

/**
 * Canonicalizes a route so the same geometry compares equally regardless of
 * whether the route points are listed forward or backward.
 */
export const getCanonicalRoutePointKey = (route: HighDensityIntraNodeRoute) => {
  const forwardKey = route.route.map(getPoint3Key).join("|")
  const reverseKey = [...route.route].reverse().map(getPoint3Key).join("|")
  return forwardKey <= reverseKey ? forwardKey : reverseKey
}

/**
 * Produces a stable sort order for routes so deterministic behavior does not
 * depend on source array ordering.
 */
export const compareRoutes = (
  a: HighDensityIntraNodeRoute,
  b: HighDensityIntraNodeRoute,
) => {
  const connectionNameCmp = a.connectionName.localeCompare(b.connectionName)
  if (connectionNameCmp !== 0) return connectionNameCmp

  const rootConnectionNameCmp = (a.rootConnectionName ?? "").localeCompare(
    b.rootConnectionName ?? "",
  )
  if (rootConnectionNameCmp !== 0) return rootConnectionNameCmp

  const routeKeyCmp = getCanonicalRoutePointKey(a).localeCompare(
    getCanonicalRoutePointKey(b),
  )
  if (routeKeyCmp !== 0) return routeKeyCmp

  return (
    compareNumbers(a.traceThickness, b.traceThickness) ||
    compareNumbers(a.viaDiameter, b.viaDiameter) ||
    compareNumbers(a.route.length, b.route.length) ||
    compareNumbers(a.vias.length, b.vias.length) ||
    compareNumbers(a.jumpers?.length ?? 0, b.jumpers?.length ?? 0)
  )
}

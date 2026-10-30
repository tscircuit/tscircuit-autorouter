import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

/** Restore the two native grid states hidden by A03/B01 endpoint replacement.
 * The pinned exporters retain one point per state but replace the first/last
 * positions with exact terminals. Two states with one via are the same grid
 * cell on two layers; the existing via record retains that cell's actual XY.
 * No new via position or path choice is introduced.
 */
export function restoreCoincidentNativeViaLandings(route: HighDensityIntraNodeRoute): HighDensityIntraNodeRoute {
  if (route.route.length !== 2 || route.vias.length !== 1) return route
  const [start, end] = route.route
  const via = route.vias[0]!
  if (!start || !end || start.x !== end.x || start.y !== end.y || start.z === end.z) return route
  if (![start.x, start.y, start.z, end.z, via.x, via.y].every(Number.isFinite)) {
    throw new Error("Native coincident layer-transition landing is nonfinite")
  }
  return { ...route, route: [start, { x: via.x, y: via.y, z: start.z }, { x: via.x, y: via.y, z: end.z }, end] }
}

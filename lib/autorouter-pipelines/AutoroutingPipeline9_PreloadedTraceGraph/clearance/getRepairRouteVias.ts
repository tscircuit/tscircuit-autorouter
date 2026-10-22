// Derived from tscircuit/repair04@4273e9455084b7b35ebc860ebe4483b9d19692ea (MIT).
import type { HighDensityRoute } from "high-density-repair03/lib"
import { isPointInBounds, REGION_EPSILON } from "./repairRegionGeometry"
import type { Bounds } from "./repairRegionTypes"

/** Keep fixed collar copper even when its layer transition is outside the crop. */
export function getRepairRouteVias({
  route,
  mutableBounds,
}: {
  route: HighDensityRoute
  mutableBounds: Bounds
}): HighDensityRoute["vias"] {
  const vias = route.vias
    .filter(
      (via) =>
        !isPointInBounds(via, mutableBounds, REGION_EPSILON * 4) &&
        route.route.some(
          (point) =>
            Math.abs(point.x - via.x) <= REGION_EPSILON &&
            Math.abs(point.y - via.y) <= REGION_EPSILON,
        ),
    )
    .map((via) => structuredClone(via))
  for (let index = 1; index < route.route.length; index++) {
    const start = route.route[index - 1]!
    const end = route.route[index]!
    if (start.z === end.z || start.toNextSegmentType === "through_obstacle")
      continue
    if (start.x !== end.x || start.y !== end.y) {
      throw new Error(
        "repair04: a layer transition must have coincident endpoints",
      )
    }
    if (!vias.some((via) => via.x === end.x && via.y === end.y)) {
      vias.push({ x: end.x, y: end.y })
    }
  }
  return vias
}

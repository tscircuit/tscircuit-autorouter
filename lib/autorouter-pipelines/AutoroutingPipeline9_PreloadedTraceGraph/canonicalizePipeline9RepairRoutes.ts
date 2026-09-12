import type { HighDensityRoute } from "lib/types/high-density-types"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"

/** Represents every via with exactly co-located points for repair04. */
export const canonicalizePipeline9RepairRoutes = (
  routes: HighDensityRoute[],
): HighDensityRoute[] => {
  return materializePipeline9HdRouteVias(routes).map(
    (route): HighDensityRoute => ({
      ...route,
      route: route.route.flatMap((point, index) => {
        const previous = route.route[index - 1]
        if (
          !previous ||
          previous.z === point.z ||
          previous.toNextSegmentType === "through_obstacle" ||
          (previous.x === point.x && previous.y === point.y)
        ) {
          return [point]
        }
        // Materialization accepts sub-micrometre coincidence; repair04 needs
        // exact XY equality. Preserve both endpoints with an explicit lead.
        return [{ x: point.x, y: point.y, z: previous.z }, point]
      }),
    }),
  )
}

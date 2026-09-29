import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { getVectorLength } from "lib/utils/getVectorLength"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

const MAX_SEGMENT_LENGTH = 0.5
const MAX_SUBDIVISIONS = 32

/** Gives local clearance projection movable vertices without changing copper. */
export const subdividePipeline9ClearanceSegments = (
  routes: HighDensityRoute[],
  errors: Pipeline9DrcError[],
): HighDensityRoute[] => {
  const traceIds = [...new Set(errors.flatMap(getDrcErrorTraceIds))]
  return routes.map((route): HighDensityRoute => {
    if (
      route.jumpers?.length ||
      !traceIds.some(
        (id) =>
          id === route.connectionName ||
          id.startsWith(`${route.connectionName}_`),
      )
    ) {
      return route
    }
    const points = route.route.flatMap((point, index) => {
      const next = route.route[index + 1]
      // Keep transitions, terminal identities and varying-width spans intact.
      if (
        !next ||
        point.z !== next.z ||
        point.toNextSegmentType ||
        point.insideJumperPad ||
        next.insideJumperPad ||
        (point.traceThickness ?? route.traceThickness) !==
          (next.traceThickness ?? route.traceThickness)
      ) {
        return [point]
      }
      const divisions = Math.min(
        MAX_SUBDIVISIONS,
        Math.ceil(
          getVectorLength(next.x - point.x, next.y - point.y) /
            MAX_SEGMENT_LENGTH,
        ),
      )
      return [
        point,
        ...Array.from({ length: Math.max(0, divisions - 1) }, (_, offset) => ({
          x: point.x + ((next.x - point.x) * (offset + 1)) / divisions,
          y: point.y + ((next.y - point.y) * (offset + 1)) / divisions,
          z: point.z,
          traceThickness: point.traceThickness,
        })),
      ]
    })
    return points.length === route.route.length
      ? route
      : { ...route, route: points }
  })
}

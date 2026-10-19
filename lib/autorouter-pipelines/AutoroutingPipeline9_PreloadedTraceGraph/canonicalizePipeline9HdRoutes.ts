import type { HighDensityRoute } from "lib/types/high-density-types"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"

/** Represents every via with exactly co-located points before repair or SRJ export. */
export const canonicalizePipeline9HdRoutes = (
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
      }).filter((point, index, points): boolean => {
        const next = points[index + 1]
        // A tagged zero-length segment has no copper extent. Keep its
        // successor's departure metadata, or extraction can mistake a plated
        // hole for a new via (or discard an existing via). Never merge points
        // with distinct terminal identities, copper widths or jumper state.
        return (
          !next ||
          (point.toNextSegmentType === undefined &&
            next.toNextSegmentType === undefined &&
            point.toNextSegmentCircuitJsonMetadata === undefined &&
            next.toNextSegmentCircuitJsonMetadata === undefined) ||
          point.x !== next.x ||
          point.y !== next.y ||
          point.z !== next.z ||
          point.pcb_port_id !== next.pcb_port_id ||
          point.traceThickness !== next.traceThickness ||
          point.insideJumperPad !== next.insideJumperPad
        )
      }),
    }),
  )
}

import type { HighDensityRoute } from "../../types/high-density-types"

/** A zero-length edge has no copper; the last point owns the outgoing edge. */
export function normalizeCoincidentRoutePoints<T extends HighDensityRoute>(
  route: T,
): T {
  const points: T["route"] = []
  let changed = false
  for (const point of route.route) {
    const previous = points.at(-1)
    if (!previous || previous.x !== point.x || previous.y !== point.y || previous.z !== point.z) {
      points.push(point)
      continue
    }
    changed = true
    if (previous.pcb_port_id && point.pcb_port_id && previous.pcb_port_id !== point.pcb_port_id) {
      throw new Error(`Coincident route points have conflicting terminal identities on ${route.connectionName}`)
    }
    const merged = { ...previous, ...point }
    // Segment properties describe the edge AFTER this coordinate. Keeping the
    // first duplicate loses a protected plated-hole traversal on the last one.
    delete merged.toNextSegmentType
    delete merged.toNextSegmentCircuitJsonMetadata
    if (point.toNextSegmentType) merged.toNextSegmentType = point.toNextSegmentType
    if (point.toNextSegmentCircuitJsonMetadata) {
      merged.toNextSegmentCircuitJsonMetadata = point.toNextSegmentCircuitJsonMetadata
    }
    points[points.length - 1] = merged
  }
  return changed ? { ...route, route: points } : route
}

import type { SimplifiedPcbTrace } from "../types"

/** Remove straight-line retracing without adding copper outside the input path. */
export function removeCollinearTracePoints(
  trace: SimplifiedPcbTrace,
): SimplifiedPcbTrace {
  const route: SimplifiedPcbTrace["route"] = []
  for (const point of trace.route) {
    while (route.length >= 2) {
      const a = route[route.length - 2]!
      const b = route[route.length - 1]!
      // Vias, jumpers, obstacle traversals, terminals, and width/layer changes
      // are electrical anchors rather than redundant path vertices.
      if (
        a.route_type !== "wire" ||
        b.route_type !== "wire" ||
        point.route_type !== "wire" ||
        a.layer !== b.layer ||
        b.layer !== point.layer ||
        a.width !== b.width ||
        b.width !== point.width ||
        b.start_pcb_port_id ||
        b.end_pcb_port_id
      ) {
        break
      }
      const abX = b.x - a.x
      const abY = b.y - a.y
      const bcX = point.x - b.x
      const bcY = point.y - b.y
      if (
        Math.abs(abX * bcY - abY * bcX) >
        1e-10 * Math.max(Math.hypot(abX, abY), Math.hypot(bcX, bcY))
      ) {
        break
      }
      route.pop()
    }
    route.push(point)
  }
  return { ...trace, route }
}

import type { HighDensityRoute } from "../types/high-density-types"

/** Remove straight-line retracing without adding copper outside the input path. */
export function removeCollinearRoutePoints(
  hdRoute: HighDensityRoute,
): HighDensityRoute["route"] {
  const route: HighDensityRoute["route"] = []
  const protectedPoints = [
    ...hdRoute.vias,
    ...(hdRoute.jumpers ?? []).flatMap((jumper) => [jumper.start, jumper.end]),
  ]
  for (const point of hdRoute.route) {
    while (route.length >= 2) {
      const a = route[route.length - 2]!
      const b = route[route.length - 1]!
      if (
        a.z !== b.z ||
        b.z !== point.z ||
        a.traceThickness !== b.traceThickness ||
        b.traceThickness !== point.traceThickness ||
        a.toNextSegmentType ||
        b.toNextSegmentType ||
        a.toNextSegmentCircuitJsonMetadata ||
        b.toNextSegmentCircuitJsonMetadata ||
        b.pcb_port_id ||
        b.insideJumperPad ||
        protectedPoints.some((p) => p.x === b.x && p.y === b.y)
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
  return route
}

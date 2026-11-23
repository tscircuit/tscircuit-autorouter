import type { SimplifiedPcbTrace } from "lib/types"

type RoutePoint = SimplifiedPcbTrace["route"][number]
type Wire = Extract<RoutePoint, { route_type: "wire" }>

/** The incoming and outgoing copper meet a via at its XY on their own layers. */
export function getWireSegmentAtRoutePoints(
  from: RoutePoint,
  to: RoutePoint,
): [Wire, Wire] | undefined {
  if (from.route_type === "wire" && to.route_type === "wire") {
    return from.layer === to.layer ? [from, to] : undefined
  }
  if (from.route_type === "wire" && to.route_type === "via") {
    if (from.layer === to.from_layer && (from.x !== to.x || from.y !== to.y)) {
      return [from, { ...from, x: to.x, y: to.y }]
    }
  }
  if (from.route_type === "via" && to.route_type === "wire") {
    if (from.to_layer === to.layer && (from.x !== to.x || from.y !== to.y)) {
      return [{ ...to, x: from.x, y: from.y }, to]
    }
  }
}

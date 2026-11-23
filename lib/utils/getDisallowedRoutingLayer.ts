import type { SimplifiedPcbTrace } from "lib/types"

/** Check the planar segment between route points. Drills and component copper may cross other layers. */
export function getDisallowedRoutingLayer(
  route: SimplifiedPcbTrace["route"],
  routingLayers: ReadonlySet<string>,
): string | undefined {
  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1]!
    const next = route[i]!
    const start = "end" in previous ? previous.end : previous
    const end = "start" in next ? next.start : next
    if (start.x === end.x && start.y === end.y) continue
    let layer = "to_layer" in previous ? previous.to_layer : previous.layer
    if (previous.route_type !== "wire" && next.route_type === "wire") {
      layer = next.layer
    }
    if (!routingLayers.has(layer)) return layer
  }
}

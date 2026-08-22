import type { SimplifiedPcbTrace } from "lib/types"

export function routeUsesOnlyRoutingLayers(
  trace: SimplifiedPcbTrace,
  allowedLayers: ReadonlySet<string>,
): boolean {
  for (const [segmentIndex, segment] of trace.route.entries()) {
    if (segment.route_type === "wire") {
      if (!allowedLayers.has(segment.layer)) return false
      continue
    }
    if (segment.route_type !== "via") continue

    const previousWire = trace.route
      .slice(0, segmentIndex)
      .reverse()
      .find((candidate) => candidate.route_type === "wire")
    const nextWire = trace.route
      .slice(segmentIndex + 1)
      .find((candidate) => candidate.route_type === "wire")
    if (
      (previousWire?.route_type === "wire" &&
        !allowedLayers.has(previousWire.layer)) ||
      (nextWire?.route_type === "wire" && !allowedLayers.has(nextWire.layer))
    ) {
      return false
    }
  }

  return true
}

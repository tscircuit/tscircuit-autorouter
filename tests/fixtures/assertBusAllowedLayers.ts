import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

/** Validate routing layers, not the physical span of through-via barrels. */
export function assertBusAllowedLayers(
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTraces,
): void {
  const constrainedBuses = srj.buses?.filter(
    (bus) => bus.allowedLayers !== undefined,
  )
  if (!constrainedBuses?.length) return

  // Output names may be net aliases or merged/MST connection names. Resolve
  // their original bus membership through the same connectivity as routing.
  const connMap = getConnectivityMapFromSimpleRouteJson({ ...srj, traces })
  const boardLayers = new Set<string>(
    Array.from({ length: srj.layerCount }, (_, z) =>
      mapZToLayerName(z, srj.layerCount),
    ),
  )
  for (const bus of constrainedBuses) {
    const allowedLayers = new Set(bus.allowedLayers)
    const busName = bus.name ?? "unnamed bus"
    for (const layer of allowedLayers) {
      if (!boardLayers.has(layer)) {
        throw new Error(
          `Bus "${busName}" allows unknown board layer "${layer}"`,
        )
      }
    }
    const memberNamesByNet = new Map<string, string>()
    for (const name of bus.connectionNames) {
      const net = connMap.getNetConnectedToId(name)
      if (net !== undefined) memberNamesByNet.set(net, name)
    }
    for (const trace of traces) {
      const net = connMap.getNetConnectedToId(trace.connection_name)
      const memberName = bus.connectionNames.includes(trace.connection_name)
        ? trace.connection_name
        : net === undefined ? undefined : memberNamesByNet.get(net)
      if (memberName === undefined) continue

      for (const point of trace.route) {
        // Via and plated-hole entry/exit layers carry the routed signal.
        // Intermediate barrel layers alone do not violate a bus restriction.
        const routingLayers =
          point.route_type === "wire" || point.route_type === "jumper"
            ? [point.layer]
            : [point.from_layer, point.to_layer]
        for (const layer of routingLayers) {
          if (!allowedLayers.has(layer)) {
            throw new Error(
              `Bus "${busName}" connection "${memberName}" uses prohibited routing layer "${layer}" (allowed: ${[...allowedLayers].join(", ")})`,
            )
          }
        }
      }
    }
  }
}

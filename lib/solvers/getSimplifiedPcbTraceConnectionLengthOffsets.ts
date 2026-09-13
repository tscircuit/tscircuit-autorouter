import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimplifiedPcbTraces } from "../types"

/** Sum immutable same-layer copper by logical connection name. */
export const getSimplifiedPcbTraceConnectionLengthOffsets = (
  traces: SimplifiedPcbTraces,
  connMap: ConnectivityMap,
): Record<string, number> => {
  const offsets: Record<string, number> = {}
  for (const trace of traces) {
    let previousWire:
      | Extract<(typeof trace.route)[number], { route_type: "wire" }>
      | undefined
    let length = 0
    for (const point of trace.route) {
      if (point.route_type !== "wire") {
        previousWire = undefined
        continue
      }
      if (previousWire?.layer === point.layer)
        length += Math.hypot(point.x - previousWire.x, point.y - previousWire.y)
      previousWire = point
    }
    const netId =
      connMap.getNetConnectedToId(trace.connection_name) ??
      trace.connection_name
    const connectionAliases = new Set([
      trace.connection_name,
      ...(trace.connectsTo ?? []),
      ...connMap.getIdsConnectedToNet(netId),
    ])
    for (const connectionAlias of connectionAliases) {
      offsets[connectionAlias] = (offsets[connectionAlias] ?? 0) + length
    }
  }
  return offsets
}

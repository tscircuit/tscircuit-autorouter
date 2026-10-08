import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteBus, SimplifiedPcbTraces } from "lib/types"

export function assertBusAllowedLayers({
  buses,
  traces,
  connMap,
}: {
  buses: SimpleRouteBus[]
  traces: SimplifiedPcbTraces
  connMap: ConnectivityMap
}): void {
  for (const bus of buses) {
    const allowedLayers = bus.allowedLayers
    if (!allowedLayers) continue
    for (const trace of traces) {
      if (
        !bus.connectionNames.some((connectionName) =>
          connMap.areIdsConnected(connectionName, trace.connection_name),
        )
      )
        continue
      for (const point of trace.route) {
        if (point.route_type !== "wire" || allowedLayers.includes(point.layer))
          continue
        throw new Error(
          `Pipeline9 bus "${bus.busId}" routed on forbidden layer "${point.layer}"`,
        )
      }
    }
  }
}

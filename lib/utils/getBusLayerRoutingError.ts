import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getAllowedZByConnection } from "./getAllowedZByConnection"
import { getConnectivityMapFromSimpleRouteJson } from "./getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

export function getBusLayerRoutingError(input: {
  srj: SimpleRouteJson
  traces: Readonly<SimplifiedPcbTraces>
}): string | undefined {
  const allowedZByConnection = getAllowedZByConnection(input.srj)
  if (allowedZByConnection.size === 0) return undefined
  const connMap = getConnectivityMapFromSimpleRouteJson(input.srj)
  for (const trace of input.traces) {
    for (const [connectionName, allowedZ] of allowedZByConnection) {
      if (!connMap.areIdsConnected(trace.connection_name, connectionName)) {
        continue
      }
      const violatesLayerRestriction = trace.route.some(
        (point) => point.route_type === "wire" &&
          !allowedZ.includes(mapLayerNameToZ(point.layer, input.srj.layerCount)),
      )
      if (violatesLayerRestriction) {
        return "Routed signal violates the bus's allowed PCB layers"
      }
    }
  }
  return undefined
}

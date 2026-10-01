import { getConnectionPointLayers } from "./connection-point-utils"
import { SimpleRouteJson } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

const pointHash = (point: { x: number; y: number }) =>
  `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`

export const getConnectivityMapFromSimpleRouteJson = (srj: SimpleRouteJson) => {
  const connMap = new ConnectivityMap({})
  for (const connection of srj.connections) {
    const connectionGroup = new Set<string>([
      connection.name,
      ...(connection.__rootConnectionNames ?? []),
    ])
    if (connection.__netConnectionName) {
      connectionGroup.add(connection.__netConnectionName)
    }

    for (const point of connection.pointsToConnect) {
      connectionGroup.add(
        `${pointHash(point)}:${getConnectionPointLayers(point)
          .map((layer) => mapLayerNameToZ(layer, srj.layerCount))
          .sort()
          .join("-")}`,
      )
      if ("pcb_port_id" in point && point.pcb_port_id) {
        connectionGroup.add(point.pcb_port_id)
      }
      if (point.pointId) {
        connectionGroup.add(point.pointId)
      }
    }
    connMap.addConnections([[...connectionGroup]])
  }
  for (const obstacle of srj.obstacles) {
    const offBoardConnections = obstacle.offBoardConnectsTo ?? []
    const connectionGroup = Array.from(
      new Set(
        [
          obstacle.obstacleId!,
          ...obstacle.connectedTo,
          ...offBoardConnections,
          `${pointHash(obstacle.center)}:${obstacle.layers
            .map((l) => mapLayerNameToZ(l, srj.layerCount))
            .sort()
            .join("-")}`,
        ].filter(Boolean),
      ),
    )

    if (connectionGroup.length > 0) {
      connMap.addConnections([connectionGroup])
    }
  }
  for (const trace of srj.traces ?? []) {
    const connectionGroup = Array.from(
      new Set(
        [
          trace.pcb_trace_id,
          trace.connection_name,
          ...(trace.connectsTo ?? []),
        ].filter(Boolean),
      ),
    )

    if (connectionGroup.length > 0) {
      connMap.addConnections([connectionGroup])
    }
  }
  return connMap
}

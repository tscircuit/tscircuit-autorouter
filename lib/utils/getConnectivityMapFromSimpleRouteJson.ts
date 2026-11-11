import { getConnectionPointLayers } from "./connection-point-utils"
import { SimpleRouteJson } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

const pointHash = (point: { x: number; y: number }) =>
  `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`

export const getConnectivityMapFromSimpleRouteJson = (
  srj: Pick<
    SimpleRouteJson,
    "connections" | "layerCount" | "obstacles" | "traces"
  >,
  independentConnectionNames: ReadonlySet<string> = new Set(),
): ConnectivityMap => {
  const connMap = new ConnectivityMap({})
  const addConnections = (ids: string[]): void => {
    const electricalIds = ids.filter(
      (id) => Boolean(id) && !independentConnectionNames.has(id),
    )
    if (electricalIds.length > 0) {
      connMap.addConnections([electricalIds])
    }
  }
  for (const connection of srj.connections) {
    // Copper ownership is narrower than electrical connectivity. An owned hop
    // must never join another hop through a net alias or a shared terminal.
    if (independentConnectionNames.has(connection.name)) {
      connMap.addConnections([[connection.name]])
      continue
    }
    for (const rootConnectionName of connection.__rootConnectionNames ?? []) {
      addConnections([connection.name, rootConnectionName])
    }
    if (connection.netConnectionName) {
      addConnections([connection.name, connection.netConnectionName])
    }
    // Also link the connection name to its overall netConnectionName if available
    if (connection.__netConnectionName) {
      addConnections([connection.name, connection.__netConnectionName])
    }

    for (const point of connection.pointsToConnect) {
      addConnections([
        connection.name,
        `${pointHash(point)}:${getConnectionPointLayers(point)
          .map((layer) => mapLayerNameToZ(layer, srj.layerCount))
          .sort()
          .join("-")}`,
      ])
      if ("pcb_port_id" in point && point.pcb_port_id) {
        addConnections([connection.name, point.pcb_port_id as string])
      }
      if (point.pointId) {
        addConnections([connection.name, point.pointId])
      }
    }
  }
  for (const obstacle of srj.obstacles) {
    const offBoardConnections = obstacle.offBoardConnectsTo ?? []
    const connectionGroup = Array.from(
      new Set([
        obstacle.obstacleId!,
        ...obstacle.connectedTo,
        ...offBoardConnections,
        `${pointHash(obstacle.center)}:${obstacle.layers
          .map((l) => mapLayerNameToZ(l, srj.layerCount))
          .sort()
          .join("-")}`,
      ]),
    )

    addConnections(connectionGroup)
  }
  for (const trace of srj.traces ?? []) {
    const connectionGroup = Array.from(
      new Set([
        trace.pcb_trace_id,
        trace.connection_name,
        ...(trace.connectsTo ?? []),
      ]),
    )

    addConnections(connectionGroup)
  }
  return connMap
}

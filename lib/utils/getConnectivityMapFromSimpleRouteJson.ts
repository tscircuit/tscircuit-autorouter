import type { SimpleRouteJson } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

const pointHash = (point: { x: number; y: number }) =>
  `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`

/**
 * Returns the physical endpoint identities of preloaded wire copper.
 * Fanout phases may retain a phase-local connection name, but touching copper
 * on the same PCB layer still belongs to the global connection at that point.
 */
const getTraceEndpointHashes = (
  trace: NonNullable<SimpleRouteJson["traces"]>[number],
  layerCount: number,
): string[] =>
  [trace.route[0], trace.route.at(-1)].flatMap((routePoint) =>
    routePoint?.route_type === "wire"
      ? [
          `${pointHash(routePoint)}:${mapLayerNameToZ(
            routePoint.layer,
            layerCount,
          )}`,
        ]
      : [],
  )

export const getConnectivityMapFromSimpleRouteJson = (srj: SimpleRouteJson) => {
  const connMap = new ConnectivityMap({})
  for (const connection of srj.connections) {
    for (const rootConnectionName of connection.__rootConnectionNames ?? []) {
      connMap.addConnections([[connection.name, rootConnectionName]])
    }
    // Also link the connection name to its overall netConnectionName if available
    if (connection.__netConnectionName) {
      connMap.addConnections([
        [connection.name, connection.__netConnectionName],
      ])
    }

    for (const point of connection.pointsToConnect) {
      connMap.addConnections([
        [
          connection.name,
          `${pointHash(point)}:${
            "layers" in point
              ? point.layers
                  .map((l) => mapLayerNameToZ(l, srj.layerCount))
                  .sort()
                  .join("-")
              : mapLayerNameToZ(point.layer, srj.layerCount)
          }`,
        ],
      ])
      if ("pcb_port_id" in point && point.pcb_port_id) {
        connMap.addConnections([[connection.name, point.pcb_port_id as string]])
      }
      if (point.pointId) {
        connMap.addConnections([[connection.name, point.pointId]])
      }
    }
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
          ...getTraceEndpointHashes(trace, srj.layerCount),
        ].filter(Boolean),
      ),
    )

    if (connectionGroup.length > 0) {
      connMap.addConnections([connectionGroup])
    }
  }
  return connMap
}

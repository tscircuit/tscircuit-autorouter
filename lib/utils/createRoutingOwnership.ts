import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { getConnectionPointLayers } from "./connection-point-utils"
import { getConnectivityMapFromSimpleRouteJson } from "./getConnectivityMapFromSimpleRouteJson"

/** Keep electrical aliases on the request; use independent copper roots while routing. */
export function createRoutingOwnership(input: SimpleRouteJson): {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
} {
  const electricalConnMap = getConnectivityMapFromSimpleRouteJson(input)
  const ownedNames = new Set(
    (input.differentialPairs ?? []).flatMap((pair) =>
      pair.connectionNames.flat(),
    ),
  )
  if (ownedNames.size === 0) {
    return { srj: input, connMap: electricalConnMap }
  }
  const ownedConnections = input.connections.filter((connection) =>
    ownedNames.has(connection.name),
  )
  const srj: SimpleRouteJson = {
    ...input,
    connections: input.connections.map((connection) =>
      ownedNames.has(connection.name)
        ? { ...connection, __rootConnectionNames: [connection.name] }
        : connection,
    ),
    obstacles: input.obstacles.map((obstacle) => ({
      ...obstacle,
      // Producers may list every trace on the electrical net on every pad.
      // Only the actual terminal pad grants an owned hop permission to enter.
      connectedTo: [
        ...obstacle.connectedTo.filter((name) => !ownedNames.has(name)),
        ...ownedConnections
          .filter(
            (connection) =>
              isObstacleConnectedToRoute(
                obstacle,
                { connectionName: connection.name },
                electricalConnMap,
              ) &&
              connection.pointsToConnect.some(
                (point) =>
                  Math.abs(point.x - obstacle.center.x) <=
                    obstacle.width / 2 + 1e-8 &&
                  Math.abs(point.y - obstacle.center.y) <=
                    obstacle.height / 2 + 1e-8 &&
                  getConnectionPointLayers(point).some((layer) =>
                    obstacle.layers.includes(layer),
                  ),
              ),
          )
          .map((connection) => connection.name),
      ],
    })),
  }
  return {
    srj,
    connMap: getConnectivityMapFromSimpleRouteJson(srj, ownedNames),
  }
}

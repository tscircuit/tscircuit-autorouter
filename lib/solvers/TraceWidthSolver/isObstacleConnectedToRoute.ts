import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"

type RouteConnectionIds = {
  connectionName: string
  rootConnectionName?: string
}

export const isObstacleConnectedToRoute = (
  obstacle: Obstacle,
  route: RouteConnectionIds,
  connMap?: ConnectivityMap,
) =>
  obstacle.connectedTo.some(
    (connectedId) =>
      connectedId === route.connectionName ||
      connectedId === route.rootConnectionName ||
      (connMap?.areIdsConnected(route.connectionName, connectedId) ?? false) ||
      (route.rootConnectionName !== undefined &&
        (connMap?.areIdsConnected(route.rootConnectionName, connectedId) ??
          false)),
  )

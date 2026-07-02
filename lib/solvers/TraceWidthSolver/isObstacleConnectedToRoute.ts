import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import { isObstacleConnectedToRoute as isObstacleDirectlyConnectedToRoute } from "lib/utils/obstacle-connection-identity"

type RouteConnectionIds = {
  connectionName: string
  rootConnectionName?: string
}

export const isObstacleConnectedToRoute = (
  obstacle: Obstacle,
  route: RouteConnectionIds,
  connMap?: ConnectivityMap,
): boolean => {
  return isObstacleDirectlyConnectedToRoute(obstacle, route, connMap)
}

import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import { ObstacleConnectionIdentity } from "lib/utils/ObstacleConnectionIdentity"

type RouteConnectionIds = {
  connectionName: string
  rootConnectionName?: string
}

export const isObstacleConnectedToRoute = (
  obstacle: Obstacle,
  route: RouteConnectionIds,
  connMap?: ConnectivityMap,
) => {
  const identity = ObstacleConnectionIdentity.fromObstacle(obstacle)

  return identity.isConnectedToRoute(route, connMap)
}

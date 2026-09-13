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
) => {
  const getCanonicalConnectionId = (connectionId: string) =>
    connMap?.getNetConnectedToId(connectionId) ?? connectionId
  const routeConnectionIds = [route.connectionName, route.rootConnectionName]
    .filter((connectionId): connectionId is string => Boolean(connectionId))
    .map(getCanonicalConnectionId)

  return obstacle.connectedTo.some((connectedId) =>
    routeConnectionIds.includes(getCanonicalConnectionId(connectedId)),
  )
}

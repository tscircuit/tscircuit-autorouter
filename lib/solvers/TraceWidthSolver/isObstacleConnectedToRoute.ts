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
): boolean => {
  if (!connMap) {
    return obstacle.connectedTo.some(
      (connectedId) =>
        connectedId === route.connectionName ||
        connectedId === route.rootConnectionName,
    )
  }

  let routeNetId = connMap.getNetConnectedToId(route.connectionName)
  if (routeNetId === undefined && route.rootConnectionName !== undefined) {
    if (Object.hasOwn(connMap.netMap, route.rootConnectionName)) {
      routeNetId = route.rootConnectionName
    } else {
      routeNetId = connMap.getNetConnectedToId(route.rootConnectionName)
    }
  }
  routeNetId ??= route.rootConnectionName ?? route.connectionName

  return obstacle.connectedTo.some(
    (connectedId) =>
      (connMap.getNetConnectedToId(connectedId) ?? connectedId) === routeNetId,
  )
}

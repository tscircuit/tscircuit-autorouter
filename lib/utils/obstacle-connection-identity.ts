import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle, ObstacleConnectionId } from "lib/types"

type ConnectivityLookup = Pick<ConnectivityMap, "areIdsConnected">

export type RouteConnectionIds = {
  readonly connectionName: string
  readonly rootConnectionName?: string
}

class ObstacleConnectionIds {
  constructor(
    private readonly connectionIds: ReadonlyArray<ObstacleConnectionId>,
  ) {}

  matchesRoute(route: RouteConnectionIds, connMap?: ConnectivityLookup): boolean {
    for (const connectedId of this.connectionIds) {
      if (this.isRouteIdMatch(route, connectedId, connMap)) {
        return true
      }
    }

    return false
  }

  private isRouteIdMatch(
    route: RouteConnectionIds,
    connectedId: ObstacleConnectionId,
    connMap?: ConnectivityLookup,
  ): boolean {
    if (connectedId === route.connectionName) return true
    if (connectedId === route.rootConnectionName) return true
    if (connMap === undefined) return false

    if (connMap.areIdsConnected(route.connectionName, connectedId)) {
      return true
    }

    if (route.rootConnectionName === undefined) {
      return false
    }

    return connMap.areIdsConnected(route.rootConnectionName, connectedId)
  }
}

export const isObstacleConnectedToRoute = (
  obstacle: Obstacle,
  route: RouteConnectionIds,
  connMap?: ConnectivityLookup,
): boolean => {
  return new ObstacleConnectionIds(obstacle.connectedTo).matchesRoute(
    route,
    connMap,
  )
}

export const isObstacleOwnedByRoute = (
  obstacle: Obstacle,
  route: RouteConnectionIds,
  connMap?: ConnectivityLookup,
): boolean => {
  return new ObstacleConnectionIds(obstacle.connectedTo).matchesRoute(
    route,
    connMap,
  )
}

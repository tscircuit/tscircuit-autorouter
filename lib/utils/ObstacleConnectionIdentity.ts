import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"

type ConnectivityLookup = Pick<ConnectivityMap, "areIdsConnected">

type RouteConnectionIds = {
  connectionName: string
  rootConnectionName?: string
}

type ObstacleConnectionIdentityInput =
  | {
      kind: "direct"
      directConnectionIds: ReadonlyArray<string>
      ownerConnectionIds: ReadonlyArray<string>
    }
  | {
      kind: "approximated"
      directConnectionIds: ReadonlyArray<string>
      ownerConnectionIds: ReadonlyArray<string>
      sourceObstacleId: string
    }

/**
 * Separates direct obstacle connectivity from ownership inherited by
 * approximation children, so generated rects do not become terminal anchors.
 */
export class ObstacleConnectionIdentity {
  private constructor(
    private readonly input: ObstacleConnectionIdentityInput,
  ) {}

  static fromObstacle(obstacle: Obstacle): ObstacleConnectionIdentity {
    const source = obstacle.approximationSource
    if (source === undefined) {
      return new ObstacleConnectionIdentity({
        kind: "direct",
        directConnectionIds: obstacle.connectedTo,
        ownerConnectionIds: obstacle.connectedTo,
      })
    }

    return new ObstacleConnectionIdentity({
      kind: "approximated",
      directConnectionIds: obstacle.connectedTo,
      ownerConnectionIds: source.connectedTo,
      sourceObstacleId: source.obstacleId,
    })
  }

  isConnectedToRoute(
    route: RouteConnectionIds,
    connMap?: ConnectivityLookup,
  ): boolean {
    for (const connectedId of this.input.directConnectionIds) {
      if (this.isRouteIdMatch(route, connectedId, connMap)) {
        return true
      }
    }

    return false
  }

  isOwnedByRoute(
    route: RouteConnectionIds,
    connMap?: ConnectivityLookup,
  ): boolean {
    for (const connectedId of this.input.ownerConnectionIds) {
      if (this.isRouteIdMatch(route, connectedId, connMap)) {
        return true
      }
    }

    return false
  }

  private isRouteIdMatch(
    route: RouteConnectionIds,
    connectedId: string,
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

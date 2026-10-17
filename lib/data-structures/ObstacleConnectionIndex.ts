import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { NetId, Obstacle, TraceId } from "lib/types"

type RouteConnectionIds = {
  connectionName: string
  rootConnectionName?: string
}

type IndexedObstacle = {
  obstacle: Obstacle
  index: number
}

/** Indexes obstacles by their direct and connectivity-map identifiers. */
export class ObstacleConnectionIndex {
  private readonly obstaclesByDirectId = new Map<
    TraceId | NetId,
    IndexedObstacle[]
  >()
  private readonly obstaclesByNetId = new Map<NetId, IndexedObstacle[]>()

  constructor(
    obstacles: ReadonlyArray<Obstacle>,
    private readonly connMap?: ConnectivityMap,
  ) {
    for (const [obstacleIndex, obstacle] of obstacles.entries()) {
      const indexedObstacle = { obstacle, index: obstacleIndex }
      for (const connectedId of new Set(obstacle.connectedTo)) {
        const directObstacles = this.obstaclesByDirectId.get(connectedId)
        if (directObstacles) directObstacles.push(indexedObstacle)
        else this.obstaclesByDirectId.set(connectedId, [indexedObstacle])

        const netId = connMap?.getNetConnectedToId(connectedId)
        if (!netId) continue
        const netObstacles = this.obstaclesByNetId.get(netId)
        if (netObstacles) netObstacles.push(indexedObstacle)
        else this.obstaclesByNetId.set(netId, [indexedObstacle])
      }
    }
  }

  getObstaclesConnectedToRoute(route: RouteConnectionIds): Obstacle[] {
    const connectedObstacles = new Map<number, Obstacle>()
    for (const routeId of [route.connectionName, route.rootConnectionName]) {
      if (!routeId) continue
      for (const { obstacle, index } of this.obstaclesByDirectId.get(routeId) ??
        []) {
        connectedObstacles.set(index, obstacle)
      }

      const netId = this.connMap?.getNetConnectedToId(routeId)
      if (!netId) continue
      for (const { obstacle, index } of this.obstaclesByNetId.get(netId) ??
        []) {
        connectedObstacles.set(index, obstacle)
      }
    }

    // Bucket lookups do not preserve the input sequence, so restore the order
    // produced by the previous obstacles.filter(...) implementation.
    return [...connectedObstacles]
      .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
      .map(([, obstacle]) => obstacle)
  }
}

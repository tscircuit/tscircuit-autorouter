import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

export type ObstacleRouteOwnershipPredicate = (obstacle: Obstacle, route: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">) => boolean

type ObstacleRouteConnectivityParams = {
  obstacles: Obstacle[]
  routes: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">[]
  connMap?: ConnectivityMap
  isObstacleOwnedByRoute?: ObstacleRouteOwnershipPredicate
}

export type ObstacleRouteConnectivity = {
  connectedRouteNamesByObstacle: string[][]
  connectedObstaclesByRoute: Obstacle[][]
}

export const getObstacleRouteConnectivity = ({
  obstacles,
  routes,
  connMap,
  isObstacleOwnedByRoute,
}: ObstacleRouteConnectivityParams): ObstacleRouteConnectivity => {
  const connectedRouteNamesByObstacle = obstacles.map((): string[] => [])
  const connectedObstaclesByRoute = routes.map((): Obstacle[] => [])

  for (
    let obstacleIndex = 0;
    obstacleIndex < obstacles.length;
    obstacleIndex++
  ) {
    const obstacle = obstacles[obstacleIndex]!
    // Duplicate ownership IDs do not change connectivity, but some imported
    // obstacles repeat them thousands of times. Keep the original for output.
    const connectivityObstacle: Obstacle = {
      ...obstacle,
      connectedTo: [...new Set(obstacle.connectedTo)],
    }
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
      const route = routes[routeIndex]!
      const owned = isObstacleOwnedByRoute
        ? isObstacleOwnedByRoute(connectivityObstacle, route)
        : isObstacleConnectedToRoute(connectivityObstacle, route, connMap)
      if (!owned) {
        continue
      }
      connectedRouteNamesByObstacle[obstacleIndex]!.push(route.connectionName)
      connectedObstaclesByRoute[routeIndex]!.push(obstacle)
    }
  }

  return { connectedRouteNamesByObstacle, connectedObstaclesByRoute }
}

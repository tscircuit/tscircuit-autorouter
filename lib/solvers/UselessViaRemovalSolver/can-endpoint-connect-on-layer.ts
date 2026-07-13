import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { HighDensityRoute } from "lib/types/high-density-types"

export const canEndpointConnectOnLayer = ({
  endpointX,
  endpointY,
  targetZ,
  obstacleSHI,
  route,
  connMap,
}: {
  endpointX: number
  endpointY: number
  targetZ: number
  obstacleSHI: ObstacleSpatialHashIndex
  route: HighDensityRoute
  connMap: ConnectivityMap
}): boolean => {
  const routeIds = [route.connectionName, route.rootConnectionName].filter(
    (id): id is string => id !== undefined,
  )
  const nearbyObstacles = obstacleSHI.searchArea(endpointX, endpointY, 2, 2)
  const connectedObstacles = nearbyObstacles.filter((obstacle) => {
    const obstacleIsConnectedToRoute = routeIds.some((routeId) =>
      obstacle.connectedTo.some(
        (connectedId) =>
          connectedId === routeId ||
          connMap.areIdsConnected(routeId, connectedId),
      ),
    )
    if (!obstacleIsConnectedToRoute) {
      return false
    }
    const halfWidth = obstacle.width / 2 + 0.05
    const halfHeight = obstacle.height / 2 + 0.05
    const withinX = Math.abs(endpointX - obstacle.center.x) <= halfWidth
    const withinY = Math.abs(endpointY - obstacle.center.y) <= halfHeight
    return withinX && withinY
  })

  if (connectedObstacles.length > 0) {
    return connectedObstacles.some((obstacle) =>
      obstacle.__zLayers?.includes(targetZ),
    )
  }

  return false
}

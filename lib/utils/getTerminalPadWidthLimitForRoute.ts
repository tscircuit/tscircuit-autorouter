import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const routeZLayers = (route: HighDensityRoute) =>
  new Set(route.route.map((point) => point.z))

const isObstacleOnRouteLayer = (
  obstacle: Obstacle,
  route: HighDensityRoute,
): boolean => {
  if (!obstacle.zLayers) return true
  const zLayers = routeZLayers(route)
  return obstacle.zLayers.some((z) => zLayers.has(z))
}

const isObstacleConnectedToRoute = (
  obstacle: Obstacle,
  route: HighDensityRoute,
  connMap?: ConnectivityMap,
): boolean => {
  const rootConnectionName = route.rootConnectionName ?? route.connectionName
  if (obstacle.connectedTo.includes(rootConnectionName)) {
    return true
  }
  if (
    route.rootConnectionName &&
    obstacle.connectedTo.includes(route.connectionName)
  ) {
    return true
  }

  if (!connMap) {
    return false
  }

  if (
    obstacle.obstacleId &&
    connMap.areIdsConnected(rootConnectionName, obstacle.obstacleId)
  ) {
    return true
  }

  return obstacle.connectedTo.some((connectedId) =>
    connMap.areIdsConnected(rootConnectionName, connectedId),
  )
}

export const getTerminalPadWidthLimitForRoute = ({
  route,
  obstacles,
  connMap,
}: {
  route: HighDensityRoute
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
}): number | undefined => {
  let widthLimit = Infinity

  for (const obstacle of obstacles) {
    if (obstacle.isCopperPour) continue
    if (!isObstacleOnRouteLayer(obstacle, route)) continue
    if (!isObstacleConnectedToRoute(obstacle, route, connMap)) continue

    widthLimit = Math.min(widthLimit, obstacle.width, obstacle.height)
  }

  return Number.isFinite(widthLimit) ? widthLimit : undefined
}

export const capTraceWidthToTerminalPads = ({
  route,
  traceWidth,
  obstacles,
  connMap,
}: {
  route: HighDensityRoute
  traceWidth: number
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
}): number => {
  const terminalPadWidthLimit = getTerminalPadWidthLimitForRoute({
    route,
    obstacles,
    connMap,
  })

  return terminalPadWidthLimit === undefined
    ? traceWidth
    : Math.min(traceWidth, terminalPadWidthLimit)
}

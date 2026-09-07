import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

const getPointToObstacleDistance = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): number => {
  const rotationRadians =
    (-1 * (obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const offsetX = point.x - obstacle.center.x
  const offsetY = point.y - obstacle.center.y
  const localX =
    offsetX * Math.cos(rotationRadians) - offsetY * Math.sin(rotationRadians)
  const localY =
    offsetX * Math.sin(rotationRadians) + offsetY * Math.cos(rotationRadians)
  const outsideX = Math.max(Math.abs(localX) - obstacle.width / 2, 0)
  const outsideY = Math.max(Math.abs(localY) - obstacle.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}

const getObstacleZLayers = (
  obstacle: Obstacle,
  layerCount: number,
): number[] => {
  const existingZLayers = obstacle.__zLayers ?? obstacle.zLayers
  if (existingZLayers) return existingZLayers

  return obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
}

export const hasPipeline9ViaToBoardObstacleConflict = ({
  routes,
  connectionNamesToValidate,
  boardObstacles,
  connMap,
  layerCount,
  viaToPadClearance,
}: {
  routes: HighDensityRoute[]
  connectionNamesToValidate?: ReadonlySet<string>
  boardObstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  viaToPadClearance: number
}): boolean =>
  routes.some((route) => {
    if (
      connectionNamesToValidate &&
      !connectionNamesToValidate.has(route.connectionName)
    ) {
      return false
    }
    const viaSpans = getPipeline9RouteCopperGeometry(route).viaSpans
    return viaSpans.some((via) =>
      boardObstacles.some((obstacle) => {
        if (isObstacleConnectedToRoute(obstacle, route, connMap)) return false
        const obstacleZLayers = getObstacleZLayers(obstacle, layerCount)
        if (!obstacleZLayers.some((z) => z >= via.minZ && z <= via.maxZ)) {
          return false
        }
        return (
          getPointToObstacleDistance(via.center, obstacle) <
          via.diameter / 2 + viaToPadClearance
        )
      }),
    )
  })

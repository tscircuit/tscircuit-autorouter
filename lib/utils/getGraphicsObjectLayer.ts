import type { ConnectionPoint, Obstacle } from "lib/types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import {
  getUniqueValidZLayers,
  getUniqueValidZLayersFromLayerNames,
} from "lib/utils/mapLayerNameToZ"

export const getGraphicsLayerFromLayerNames = (
  layerNames: readonly string[],
  layerCount: number,
) => `z${getUniqueValidZLayersFromLayerNames(layerNames, layerCount).join(",")}`

export const getGraphicsLayerForConnectionPoint = (
  point: ConnectionPoint,
  layerCount: number,
) => getGraphicsLayerFromLayerNames(getConnectionPointLayers(point), layerCount)

export const getGraphicsLayerForObstacle = (
  obstacle: Obstacle,
  layerCount: number,
) => {
  const zLayers =
    obstacle.zLayers && obstacle.zLayers.length > 0
      ? getUniqueValidZLayers(obstacle.zLayers, layerCount)
      : getUniqueValidZLayersFromLayerNames(obstacle.layers, layerCount)

  return `z${zLayers.join(",")}`
}

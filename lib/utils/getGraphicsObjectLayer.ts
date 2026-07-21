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

/** Resolves an obstacle's canonical, valid z layers, preferring __zLayers. */
export const getGraphicsZLayersForObstacle = (
  obstacle: Obstacle,
  layerCount: number,
): number[] => {
  if (obstacle.__zLayers && obstacle.__zLayers.length > 0) {
    return getUniqueValidZLayers(obstacle.__zLayers, layerCount)
  }

  return getUniqueValidZLayersFromLayerNames(obstacle.layers, layerCount)
}

export const getGraphicsLayerForObstacle = (
  obstacle: Obstacle,
  layerCount: number,
): string => `z${getGraphicsZLayersForObstacle(obstacle, layerCount).join(",")}`

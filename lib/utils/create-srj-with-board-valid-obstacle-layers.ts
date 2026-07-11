import type { Obstacle, SimpleRouteJson } from "lib/types"
import {
  getUniqueValidZLayers,
  getUniqueValidZLayersFromLayerNames,
} from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

function getObstacleZLayersOnBoard(
  obstacle: Obstacle,
  layerCount: number,
): number[] {
  const explicitZLayers = getUniqueValidZLayers(
    obstacle.zLayers ?? [],
    layerCount,
  )
  if (explicitZLayers.length > 0) return explicitZLayers

  const namedZLayers = getUniqueValidZLayersFromLayerNames(
    obstacle.layers,
    layerCount,
  )
  if (namedZLayers.length > 0) return namedZLayers

  throw new Error(
    `Obstacle "${obstacle.obstacleId ?? "unknown"}" has no layers on this ${layerCount}-layer board`,
  )
}

function createObstacleWithBoardValidLayers(
  obstacle: Obstacle,
  layerCount: number,
): Obstacle {
  const zLayers = getObstacleZLayersOnBoard(obstacle, layerCount)

  return {
    ...obstacle,
    layers: zLayers.map((z) => mapZToLayerName(z, layerCount)),
    zLayers,
  }
}

export function createSrjWithBoardValidObstacleLayers(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  return {
    ...srj,
    obstacles: srj.obstacles.map((obstacle) =>
      createObstacleWithBoardValidLayers(obstacle, srj.layerCount),
    ),
    jumpers: srj.jumpers?.map((jumper) => ({
      ...jumper,
      pads: jumper.pads.map((pad) =>
        createObstacleWithBoardValidLayers(pad, srj.layerCount),
      ),
    })),
  }
}

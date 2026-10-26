import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { ConnectionPoint, Obstacle } from "lib/types"
import { getConnectionPointLayers } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

const TARGET_POINT_OBSTACLE_TOLERANCE = 1e-3

export function isConnectionPointOnObstacle(input: {
  point: ConnectionPoint
  obstacle: Obstacle
  layerCount: number
}): boolean {
  // connectedTo can contain every terminal on the net, including remote pads.
  // Active target ownership therefore also requires physical layer and geometry.
  if (input.obstacle.connectedTo.length === 0) return false

  if (
    pointToBoxDistance(input.point, input.obstacle) >
    TARGET_POINT_OBSTACLE_TOLERANCE
  ) {
    return false
  }

  const pointZLayers: number[] = getConnectionPointLayers(input.point).map(
    (layer) => mapLayerNameToZ(layer, input.layerCount),
  )
  const obstacleZLayers: number[] = input.obstacle.layers.map((layer) =>
    mapLayerNameToZ(layer, input.layerCount),
  )
  return pointZLayers.some((z) => obstacleZLayers.includes(z))
}

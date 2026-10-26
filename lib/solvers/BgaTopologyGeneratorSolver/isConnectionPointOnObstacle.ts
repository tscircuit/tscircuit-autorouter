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

  const rotationRadians =
    (-(input.obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const offsetX = input.point.x - input.obstacle.center.x
  const offsetY = input.point.y - input.obstacle.center.y
  const localPoint = {
    x:
      offsetX * Math.cos(rotationRadians) - offsetY * Math.sin(rotationRadians),
    y:
      offsetX * Math.sin(rotationRadians) + offsetY * Math.cos(rotationRadians),
  }
  if (
    pointToBoxDistance(localPoint, {
      center: { x: 0, y: 0 },
      width: input.obstacle.width,
      height: input.obstacle.height,
    }) > TARGET_POINT_OBSTACLE_TOLERANCE
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

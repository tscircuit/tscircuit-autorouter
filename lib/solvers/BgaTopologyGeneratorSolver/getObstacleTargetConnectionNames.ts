import type { Obstacle, SimpleRouteJson } from "lib/types"
import { isConnectionPointOnObstacle } from "./isConnectionPointOnObstacle"

/** Returns all original root connection IDs represented by a target point. */
export function getObstacleTargetConnectionNames(input: {
  obstacle: Obstacle
  srj: SimpleRouteJson
}): string[] {
  for (const connection of input.srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (
        isConnectionPointOnObstacle({
          point,
          obstacle: input.obstacle,
          layerCount: input.srj.layerCount,
        })
      ) {
        return connection.__rootConnectionNames?.length
          ? [...new Set(connection.__rootConnectionNames)]
          : [connection.name]
      }
    }
  }

  return []
}

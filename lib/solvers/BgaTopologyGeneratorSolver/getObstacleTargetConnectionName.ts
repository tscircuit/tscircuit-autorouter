import type { Obstacle, SimpleRouteJson } from "lib/types";
import { isConnectionPointOnObstacle } from "./isConnectionPointOnObstacle";

export function getObstacleTargetConnectionName(input: {
  obstacle: Obstacle;
  srj: SimpleRouteJson;
}): string | undefined {
  for (const connection of input.srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (
        isConnectionPointOnObstacle({
          point,
          obstacle: input.obstacle,
          layerCount: input.srj.layerCount,
        })
      ) {
        return connection.__rootConnectionNames?.[0] ?? connection.name;
      }
    }
  }

  return undefined;
}

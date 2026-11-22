import type { Obstacle } from "lib/types"

/** Copper that can already carry a route between layers without drilling a via. */
export const isExistingMultilayerObstacle = (obstacle: Obstacle): boolean =>
  !obstacle.representsFutureVia &&
  (obstacle.__zLayers?.length ?? obstacle.layers?.length ?? 0) > 1

import type { Obstacle, SimpleRouteJson } from "lib/types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"

/** Preserve exact pad shapes while retaining newly generated escape vias. */
export const getPipeline9PhysicalObstacles = (
  original: SimpleRouteJson,
  withEscapeVias: SimpleRouteJson,
  escapePointIds: Iterable<string>,
): Obstacle[] => {
  const escapeObstacleIds = new Set(
    [...escapePointIds].map((id) => `escape-via-obstacle:${id}`),
  )
  const physical = filterObstaclesOutsideBoard(
    createSrjWithBoardValidObstacleLayers(original),
  )
  return [
    ...physical.obstacles,
    ...withEscapeVias.obstacles.filter((obstacle) =>
      escapeObstacleIds.has(obstacle.obstacleId!),
    ),
  ]
}

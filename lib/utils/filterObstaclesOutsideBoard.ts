import {
  doBoundsOverlap,
  isRectOverlappingPolygon,
} from "@tscircuit/math-utils"
import { getBoardBounds } from "@tscircuit/circuit-json-util"
import type { PcbBoard } from "circuit-json"
import type { Obstacle, SimpleRouteJson } from "lib/types"

const hasObstacleConnectivity = (obstacle: Obstacle) =>
  (obstacle.connectedTo?.length ?? 0) > 0 ||
  (obstacle.offBoardConnectsTo?.length ?? 0) > 0 ||
  obstacle.netIsAssignable === true

export const shouldIgnoreObstacleForBoardAutorouting = (
  obstacle: Obstacle,
  srj: Pick<SimpleRouteJson, "bounds" | "outline">,
) => {
  if (hasObstacleConnectivity(obstacle)) return false

  if (srj.outline && srj.outline.length >= 3) {
    return !isRectOverlappingPolygon(obstacle, srj.outline)
  }

  return !doBoundsOverlap(
    {
      minX: obstacle.center.x - obstacle.width / 2,
      maxX: obstacle.center.x + obstacle.width / 2,
      minY: obstacle.center.y - obstacle.height / 2,
      maxY: obstacle.center.y + obstacle.height / 2,
    },
    srj.bounds,
  )
}

export const filterObstaclesOutsideBoard = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  const obstacles = srj.obstacles.filter(
    (obstacle) => !shouldIgnoreObstacleForBoardAutorouting(obstacle, srj),
  )
  const obstaclesWereFiltered = obstacles.length !== srj.obstacles.length
  const bounds =
    obstaclesWereFiltered && srj.outline && srj.outline.length >= 3
      ? getBoardBounds({
          type: "pcb_board",
          pcb_board_id: "__autorouting_board_outline__",
          center: { x: 0, y: 0 },
          thickness: 1,
          num_layers: srj.layerCount,
          material: "fr4",
          outline: srj.outline,
        } satisfies PcbBoard)
      : srj.bounds

  if (!obstaclesWereFiltered) {
    return srj
  }

  return {
    ...srj,
    obstacles,
    bounds,
  }
}

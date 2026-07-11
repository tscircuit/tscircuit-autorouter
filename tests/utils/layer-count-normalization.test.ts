import { expect, test } from "bun:test"
import { getObstacleAvailableZ } from "lib/solvers/BgaTopologyGeneratorSolver/bgpTopologyGeneratorShared"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getGraphicsLayerForObstacle } from "lib/utils/getGraphicsObjectLayer"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"

test("normalizes obstacle layers to the board layer count", (): void => {
  const obstacle: Obstacle = {
    obstacleId: "through-hole",
    type: "rect",
    layers: ["top", "inner1", "inner2", "bottom"],
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    connectedTo: [],
  }

  expect(getUniqueValidZLayersFromLayerNames(obstacle.layers, 2)).toEqual([
    0, 1,
  ])
  expect(getObstacleAvailableZ(obstacle, 2)).toEqual([0, 1])
  expect(getGraphicsLayerForObstacle(obstacle, 2)).toBe("z0,1")
  expect(createObjectsWithZLayers([obstacle], 2)[0]!.zLayers).toEqual([0, 1])

  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    obstacles: [obstacle],
    connections: [],
  }
  const outputObstacle =
    createSrjWithBoardValidObstacleLayers(srj).obstacles[0]!

  expect(outputObstacle.layers).toEqual(["top", "bottom"])
  expect(outputObstacle.zLayers).toEqual([0, 1])
})

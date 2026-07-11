import { expect, test } from "bun:test"
import { getObstacleAvailableZ } from "lib/solvers/BgaTopologyGeneratorSolver/bgpTopologyGeneratorShared"
import type { Obstacle } from "lib/types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
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
})

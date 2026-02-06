import { expect, test } from "bun:test"
import { applyObstacleProximityWeighting } from "lib/utils/getIntraNodeCrossingsWithObstacleProximity"

test("obstacle proximity weighting affects crossing costs when enabled", () => {
  const node = {
    capacityMeshNodeId: "node1",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layer: "top" as const,
    availableZ: [0, 1],
  }

  // Case 1: No obstacles
  const resultNoObstacles = applyObstacleProximityWeighting(
    node,
    5, // crossings
    2,
    1,
    undefined,
  )
  expect(resultNoObstacles.numProximityWeightedSameLayerCrossings).toBe(5)

  // Case 2: With obstacles
  const simpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [
      {
        type: "rect" as const,
        obstacleId: "obs1",
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  }

  const resultWithObstacles = applyObstacleProximityWeighting(
    node,
    5, // same initial crossings
    2,
    1,
    simpleRouteJson,
  )
  // Should be weighted by 1.2x when 1 obstacle is nearby
  expect(resultWithObstacles.numProximityWeightedSameLayerCrossings).toBe(
    5 * 1.2,
  )
})

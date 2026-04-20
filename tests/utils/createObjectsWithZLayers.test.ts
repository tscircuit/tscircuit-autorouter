import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

test("preserves obstacle ccwRotationDegrees while normalizing zLayers", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1, y: 2 },
        width: 3,
        height: 1,
        ccwRotationDegrees: 45,
        connectedTo: [],
      },
    ],
  }

  const [normalizedObstacle] = createObjectsWithZLayers(
    srj.obstacles,
    srj.layerCount,
  )

  expect(normalizedObstacle.ccwRotationDegrees).toBe(45)
  expect(normalizedObstacle.zLayers).toEqual([0])
})

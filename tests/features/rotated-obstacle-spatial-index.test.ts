import { expect, test } from "bun:test"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { Obstacle } from "lib/types"

test.each(["native", "rbush", "flatbush"] as const)(
  "%s obstacle index includes rotated extents",
  (implementation) => {
    const obstacle: Obstacle = {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 4,
      height: 1,
      ccwRotationDegrees: 45,
      layers: ["top"],
      connectedTo: [],
    }
    const index = new ObstacleSpatialHashIndex(implementation, [obstacle])

    expect(
      index.search({ minX: 1.5, minY: 1.5, maxX: 1.5, maxY: 1.5 }),
    ).toEqual([obstacle])
    expect(index.search({ minX: 2, minY: 0, maxX: 2, maxY: 0 })).toEqual([])
  },
)

import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("rotated obstacle approximation does not change at high obstacle counts", () => {
  const createSrj = (obstacleCount: number): SimpleRouteJson => ({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -100, minY: -10, maxX: 100, maxY: 10 },
    obstacles: Array.from({ length: obstacleCount }, (_, index) => ({
      obstacleId: `rotated_pad_${index}`,
      type: "rect" as const,
      layers: ["top"],
      center: { x: index * 3, y: 0 },
      width: 1.125,
      height: 1.75,
      ccwRotationDegrees: 233,
      connectedTo: [`net_${index}`],
    })),
    connections: [],
  })

  const twentyObstacleResult = addApproximatingRectsToSrj(createSrj(20))
  const twentyOneObstacleResult = addApproximatingRectsToSrj(createSrj(21))
  const twentyObstaclePad = twentyObstacleResult.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("rotated_pad_0"),
  )
  const twentyOneObstaclePad = twentyOneObstacleResult.obstacles.filter(
    (obstacle) => obstacle.obstacleId?.startsWith("rotated_pad_0"),
  )

  expect(twentyObstaclePad.length).toBeGreaterThan(1)
  expect(twentyOneObstaclePad).toEqual(twentyObstaclePad)
})

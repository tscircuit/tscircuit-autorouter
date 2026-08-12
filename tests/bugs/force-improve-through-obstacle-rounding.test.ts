import { expect, test } from "bun:test"
import { createForceImproveThroughObstacleRoundingRepro } from "tests/fixtures/force-improve-through-obstacle-rounding"

test.failing(
  "force improvement preserves a through-obstacle endpoint on the obstacle boundary",
  () => {
    const { inputRoute, obstacle, outputRoute } =
      createForceImproveThroughObstacleRoundingRepro()
    const obstacleMinX = obstacle.center.x - obstacle.width / 2

    expect(inputRoute.route[0]).toMatchObject({
      x: obstacleMinX,
      toNextSegmentType: "through_obstacle",
    })
    expect(outputRoute.route[0]!.toNextSegmentType).toBe("through_obstacle")
    expect(outputRoute.route[0]!.x).toBeGreaterThanOrEqual(obstacleMinX)
  },
)

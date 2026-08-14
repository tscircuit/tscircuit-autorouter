import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import {
  createXiaoCladSrj,
  XIAO_CLAD_HEIGHT,
  XIAO_CLAD_WIDTH,
} from "../../fixtures/prefab-clad/create-xiao-clad-srj"

test("XIAO clad without pin headers uses castellated top pads", () => {
  const srj = createXiaoCladSrj(false)
  const pinObstacles = srj.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("obstacle_xiao_left_pin_") ||
    obstacle.obstacleId?.startsWith("obstacle_xiao_right_pin_"),
  )
  const prefabVias = srj.obstacles.filter(
    (obstacle) => obstacle.netIsAssignable === true,
  )

  expect(srj.bounds.maxX - srj.bounds.minX).toBe(XIAO_CLAD_WIDTH)
  expect(srj.bounds.maxY - srj.bounds.minY).toBe(XIAO_CLAD_HEIGHT)
  expect(pinObstacles).toHaveLength(14)
  expect(pinObstacles.every((obstacle) => obstacle.layers.length === 1)).toBe(
    true,
  )
  expect(pinObstacles.every((obstacle) => obstacle.width === 3)).toBe(true)
  expect(prefabVias).toHaveLength(15)

  const solver = new AssignableAutoroutingPipeline2(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})

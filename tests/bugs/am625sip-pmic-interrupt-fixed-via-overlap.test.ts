import { expect, test } from "bun:test"
import realBoardPhase from "../../fixtures/repro/am625sip-pmic-interrupt-real-board.srj.json"
import type { SimpleRouteJson } from "lib/types"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"

test("preserves all copper layers of the real AM625SIP fixed through-via", () => {
  const input = structuredClone(realBoardPhase) as SimpleRouteJson
  const fixedCopperObstacles = getObstaclesFromSrjTraces(input)
  const productionViaObstacle = fixedCopperObstacles.find(
    (obstacle) =>
      obstacle.obstacleId?.includes("source_trace_413_0") === true &&
      Math.abs(obstacle.center.x - 4.715800858003316) < 1e-9 &&
      Math.abs(obstacle.center.y - 21.387183241615393) < 1e-9,
  )

  expect(productionViaObstacle).toBeDefined()
  expect(productionViaObstacle?.layers).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])
})

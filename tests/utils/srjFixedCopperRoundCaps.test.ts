import { expect, test } from "bun:test"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"
import {
  fixedCopperSrj,
  fixedCopperObstacleGraphics,
  obstacleContainsPoint,
} from "tests/fixtures/srj-fixed-copper"

test("repro: SRJ trace obstacles omit caps and square off circular vias", async () => {
  const before = JSON.stringify(fixedCopperSrj)
  const obstacles = getObstaclesFromSrjTraces(fixedCopperSrj)
  expect(
    obstacles.some(
      (obstacle) =>
        obstacle.layers.includes("top") &&
        obstacleContainsPoint(obstacle, { x: -0.15, y: 0 }),
    ),
  ).toBe(false)
  expect(
    obstacles.some(
      (obstacle) =>
        obstacle.layers.includes("inner1") &&
        obstacleContainsPoint(obstacle, { x: 2.35, y: 0.35 }),
    ),
  ).toBe(true)
  expect(JSON.stringify(fixedCopperSrj)).toBe(before)
  await expect(fixedCopperObstacleGraphics(obstacles)).toMatchGraphicsSvg(
    import.meta.path,
  )
})

import { expect, test } from "bun:test"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"
import { fixedCopperSrj, fixedCopperObstacleGraphics, obstacleContainsPoint } from "tests/fixtures/srj-fixed-copper"

test("SRJ trace obstacles preserve round caps and circular vias", async () => {
  const before = JSON.stringify(fixedCopperSrj)
  const obstacles = getObstaclesFromSrjTraces(fixedCopperSrj)
  expect(obstacles.some((obstacle) => obstacle.layers.includes("top") && obstacleContainsPoint(obstacle, { x: -0.15, y: 0 }))).toBe(true)
  expect(obstacles.some((obstacle) => obstacle.layers.includes("inner1") && obstacleContainsPoint(obstacle, { x: 2.35, y: 0.35 }))).toBe(false)
  expect(obstacles.every((obstacle) => obstacle.connectedTo.includes("FIXED") && obstacle.connectedTo.includes("fixed_trace"))).toBe(true)
  expect(JSON.stringify(fixedCopperSrj)).toBe(before)
  await expect(fixedCopperObstacleGraphics(obstacles)).toMatchGraphicsSvg(import.meta.path)
})

import { expect, test } from "bun:test"
import input from "@tscircuit/dataset-srj24/samples/sample024.json"
import type { SimpleRouteJson } from "lib/types"
import { mergeAnonymousObstacleRects } from "lib/utils/mergeAnonymousObstacleRects"

test("sample024 cutout interiors merge without changing their covered area", () => {
  const srj = input as unknown as SimpleRouteJson
  const before = srj.obstacles.filter(
    (obstacle): boolean =>
      obstacle.obstacleId === undefined && obstacle.componentId === undefined,
  )
  const result = mergeAnonymousObstacleRects(srj.obstacles)
  const after = result.filter(
    (obstacle): boolean =>
      obstacle.obstacleId === undefined && obstacle.componentId === undefined,
  )
  expect(after.length).toBeLessThan(before.length)
  expect(
    after.some(
      (obstacle): boolean => obstacle.width > 54.9 && obstacle.height > 56.9,
    ),
  ).toBe(true)

  // Every boundary of either decomposition partitions the plane into cells
  // with constant coverage. Check all cells, rather than random sample points.
  const rects = [...before, ...after]
  const xs = [
    ...new Set(
      rects.flatMap((r): number[] => [
        r.center.x - r.width / 2,
        r.center.x + r.width / 2,
      ]),
    ),
  ].sort((a, b): number => a - b)
  const ys = [
    ...new Set(
      rects.flatMap((r): number[] => [
        r.center.y - r.height / 2,
        r.center.y + r.height / 2,
      ]),
    ),
  ].sort((a, b): number => a - b)
  let mismatches = 0
  for (let row = 0; row + 1 < ys.length; row++) {
    if (ys[row + 1]! - ys[row]! <= 1e-9) continue
    const y = (ys[row]! + ys[row + 1]!) / 2
    for (let column = 0; column + 1 < xs.length; column++) {
      if (xs[column + 1]! - xs[column]! <= 1e-9) continue
      const x = (xs[column]! + xs[column + 1]!) / 2
      const coveredBefore = before.some(
        (r): boolean =>
          Math.abs(x - r.center.x) < r.width / 2 &&
          Math.abs(y - r.center.y) < r.height / 2,
      )
      const coveredAfter = after.some(
        (r): boolean =>
          Math.abs(x - r.center.x) < r.width / 2 &&
          Math.abs(y - r.center.y) < r.height / 2,
      )
      if (coveredBefore !== coveredAfter) mismatches++
    }
  }
  expect(mismatches).toBe(0)
})

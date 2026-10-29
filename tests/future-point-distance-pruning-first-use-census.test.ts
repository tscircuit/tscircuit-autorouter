import { expect, test } from "bun:test"
import { makeOwnedFutureDistancePruningSolver, queryNode } from "./fixtures/futurePointDistancePruningSynthetic"

test("cold census marks a genuine skipped square root once and has no later telemetry writes", () => {
  const { solver, stats } = makeOwnedFutureDistancePruningSolver(8)
  expect(stats).toEqual({ instances: 1, contextsPruned: 0 })
  solver.futureConnectionPoints = Array.from({ length: 8 }, (_, x) => ({ x: 8 - x, y: 0, z: 0 }))
  solver.getClosestFutureConnectionPoint(queryNode(0, 0, 0))
  // Every point was closer than its predecessor: no square root was skipped.
  expect(stats.contextsPruned).toBe(0)
  solver.futureConnectionPoints = solver.futureConnectionPoints.toReversed()
  solver.getClosestFutureConnectionPoint(queryNode(0, 0, 0))
  expect(stats).toEqual({ instances: 1, contextsPruned: 1 })
  Object.freeze(stats)
  for (let i = 0; i < 1000; i++) solver.getClosestFutureConnectionPoint(queryNode((i % 51) * .05, (i % 37) * .05, i % 4))
  expect(stats.contextsPruned).toBe(1)
})

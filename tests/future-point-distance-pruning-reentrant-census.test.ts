import { expect, test } from "bun:test"
import { makeOwnedFutureDistancePruningSolver, queryNode } from "./fixtures/futurePointDistancePruningSynthetic"

test("first-use census is reentrant and survives a later native coordinate exception", () => {
  const nested = makeOwnedFutureDistancePruningSolver(8)
  nested.solver.getNodeKey = () => NaN
  const points = Array.from({ length: 8 }, (_, x) => ({ x, y: 0, z: 0 }))
  let entered = false
  Object.defineProperty(points[0], "x", { get() {
    if (!entered) {
      entered = true
      expect(nested.solver.getClosestFutureConnectionPoint(queryNode(0, 0, 0))).toBe(points[0])
      expect(nested.stats.contextsPruned).toBe(1)
    }
    return 0
  } })
  nested.solver.futureConnectionPoints = points
  expect(nested.solver.getClosestFutureConnectionPoint(queryNode(0, 0, 0))).toBe(points[0])
  expect(entered).toBeTrue()
  expect(nested.stats).toEqual({ instances: 1, contextsPruned: 1 })
  Object.freeze(nested.stats)
  expect(nested.solver.getClosestFutureConnectionPoint(queryNode(1, 0, 0))).toBe(points[1])

  const throwing = makeOwnedFutureDistancePruningSolver(8)
  throwing.solver.getNodeKey = () => NaN
  const laterFailure = Array.from({ length: 8 }, (_, x) => ({ x, y: 0, z: 0 }))
  Object.defineProperty(laterFailure[2], "x", { get() { throw new RangeError("after first actual skip") } })
  throwing.solver.futureConnectionPoints = laterFailure
  expect(() => throwing.solver.getClosestFutureConnectionPoint(queryNode(0, 0, 0))).toThrow("after first actual skip")
  expect(throwing.stats).toEqual({ instances: 1, contextsPruned: 1 })
  Object.freeze(throwing.stats)
  throwing.solver.futureConnectionPoints = points
  expect(throwing.solver.getClosestFutureConnectionPoint(queryNode(0, 0, 0))).toBe(points[0])
  expect(throwing.stats.contextsPruned).toBe(1)
})

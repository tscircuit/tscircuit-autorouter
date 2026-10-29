import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { makeOwnedFutureDistancePruningSolver, queryNode, type Point } from "./fixtures/futurePointDistancePruningSynthetic"

test("owned miss pruning preserves native first-minimum references, floating queries and invalidation epochs", () => {
  for (const count of [8, 9, 32, 63, 64, 65, 128]) {
    const { solver, stats } = makeOwnedFutureDistancePruningSolver(count)
    for (const point of solver.futureConnectionPoints) Object.freeze(point)
    const reference = (node: Point): Point | null => {
      let best = Infinity, result: Point | null = null
      for (const point of solver.futureConnectionPoints) {
        const candidate = distance(node, point) + (node.z !== point.z ? solver.viaPenaltyDistance : 0)
        if (candidate < best) { best = candidate; result = point }
      }
      return result
    }
    for (let index = 0; index < 1500; index++) {
      const node = queryNode((index * 17 % 91 - 45) * .05, (index * 13 % 87 - 43) * .05, index % 4)
      for (const query of [node, { ...node }, { ...node, x: node.x + .004 }, node]) {
        expect(solver.getClosestFutureConnectionPoint(query)).toBe(reference(query))
      }
    }
    for (const node of [queryNode(-0, 0, 0), queryNode(0, -0, 1), queryNode(Infinity, 0, 0), queryNode(NaN, 0, 0), queryNode(1e150, -1e150, 3)]) {
      expect(solver.getClosestFutureConnectionPoint(node)).toBe(reference(node))
    }
    solver.futureConnectionPoints = [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, ...Array.from({ length: 6 }, () => ({ x: 100, y: 100, z: 0 }))]
    const center = queryNode(0, 0, 0)
    expect(solver.getClosestFutureConnectionPoint(center)).toBe(solver.futureConnectionPoints[0])
    solver.futureConnectionPoints = solver.futureConnectionPoints.toReversed()
    expect(solver.getClosestFutureConnectionPoint(center)).toBe(solver.futureConnectionPoints[6])
    solver.futureConnectionPoints.push({ x: 0, y: 0, z: 1 })
    solver.VIA_PENALTY_FACTOR = 0
    expect(solver.getClosestFutureConnectionPoint(center)).toBe(solver.futureConnectionPoints[8])
    solver.VIA_PENALTY_FACTOR = 2
    expect(solver.getClosestFutureConnectionPoint(center)).toBe(solver.futureConnectionPoints[6])
    solver.futureConnectionPoints = []
    expect(solver.getClosestFutureConnectionPoint(center)).toBeNull()
    expect(solver.getClosestFutureConnectionPoint(center)).toBeNull()
    expect(stats.instances).toBe(1)
    expect(stats.contextsPruned).toBe(1)
    expect(Object.keys(stats)).toEqual(["instances", "contextsPruned"])
    expect((solver as any).closestFuturePointCacheIndices.length).toBe(256)
    expect((solver as any).closestFuturePointCacheCoordinates.length).toBe(256 * 4)
  }
})

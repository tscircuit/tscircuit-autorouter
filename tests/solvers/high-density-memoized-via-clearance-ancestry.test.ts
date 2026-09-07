import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("via clearance always checks the arrival path's own vias before static cache lookup", () => {
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "route",
    obstacleRoutes: [{
      connectionName: "far-obstacle",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [{ x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }],
      vias: [],
    }],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 1 },
  })
  let searches = 0
  const search = solver.obstacleSegmentIndex!.search.bind(solver.obstacleSegmentIndex!)
  solver.obstacleSegmentIndex!.search = (...args: Parameters<typeof search>): number[] => {
    searches++
    const results = search(...args)
    return results
  }
  const start: Node = { x: 0.05, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  const previousVia = { ...start, z: 1, parent: start }
  const clearParent = { ...start, x: 0.1, z: 1 }
  const parentWithVia = { ...clearParent, parent: previousVia }
  const clearArrival = { ...start, x: 0, parent: clearParent }
  const blockedArrival = { ...clearArrival, parent: parentWithVia }

  expect(solver.isNodeTooCloseToObstacle(clearArrival, undefined, true)).toBe(false)
  expect(searches).toBe(1)
  expect(solver.isNodeTooCloseToObstacle(blockedArrival, undefined, true)).toBe(true)
  expect(searches).toBe(1)
  expect(solver.isNodeTooCloseToObstacle(clearArrival, undefined, true)).toBe(false)
  expect(searches).toBe(1)

  const otherClearArrival = { ...clearArrival, y: 0.1 }
  const otherBlockedArrival = { ...blockedArrival, y: 0.1 }
  expect(solver.isNodeTooCloseToObstacle(otherBlockedArrival, undefined, true)).toBe(true)
  expect(searches).toBe(1)
  expect(solver.isNodeTooCloseToObstacle(otherClearArrival, undefined, true)).toBe(false)
  expect(searches).toBe(2)
  expect(solver.isNodeTooCloseToObstacle(otherBlockedArrival, undefined, true)).toBe(true)
  expect(searches).toBe(2)
  expect(solver.isNodeTooCloseToObstacle(otherClearArrival, undefined, true)).toBe(false)
  expect(searches).toBe(2)
})

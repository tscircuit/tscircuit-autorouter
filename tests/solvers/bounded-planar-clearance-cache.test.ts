import { expect, test } from "bun:test"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("bounded planar clearance cache preserves geometry after eviction and invalidation", () => {
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "active",
    minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    A: { x: -3, y: 0, z: 0 },
    B: { x: 3, y: 0, z: 0 },
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    obstacleRoutes: [
      {
        connectionName: "barrier",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: -3, z: 0 },
          { x: 0, y: 3, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  const parent: Node = { x: 1, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  for (let index = 0; index < 9000; index++) {
    const node: Node = { ...parent, x: 2, y: index, parent }
    expect(solver.isNodeTooCloseToObstacle(node)).toBe(false)
    expect(solver.freePlanarObstaclePoints.size).toBeLessThanOrEqual(4096)
  }
  for (const x of [2, 0.1, 0.25, 0, 2]) {
    const node: Node = { ...parent, x, parent }
    expect(solver.isNodeTooCloseToObstacle(node)).toBe(x < 0.2)
  }
  const node: Node = { ...parent, x: 0.25, parent }
  expect(solver.isNodeTooCloseToObstacle(node)).toBe(false)
  solver.obstacleMargin = 0.2
  expect(solver.isNodeTooCloseToObstacle(node)).toBe(true)
  solver.obstacleMargin = 0.1
  expect(solver.isNodeTooCloseToObstacle(node)).toBe(false)
  solver.obstacleRoutes[0]!.route[0]!.x = 0.25
  solver.obstacleRoutes[0]!.route[1]!.x = 0.25
  solver.buildObstacleIndexes()
  expect(solver.isNodeTooCloseToObstacle(node)).toBe(true)
})

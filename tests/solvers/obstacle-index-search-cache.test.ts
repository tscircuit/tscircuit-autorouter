import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("reuses the last exact query for each immutable obstacle index", () => {
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "route",
    obstacleRoutes: [
      {
        connectionName: "obstacle",
        route: [
          { x: -1, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
        ],
        vias: [{ x: 0, y: 1 }],
        traceThickness: 0.1,
        viaDiameter: 0.3,
      },
    ],
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    A: { x: -1, y: -1, z: 0 },
    B: { x: 1, y: -1, z: 0 },
    availableZ: [0, 1],
  })
  const segmentIndex = solver.obstacleSegmentIndex!
  const viaIndex = solver.obstacleViaIndex!
  const segmentSearch = segmentIndex.search.bind(segmentIndex)
  const viaSearch = viaIndex.search.bind(viaIndex)
  let segmentSearches = 0
  let viaSearches = 0
  segmentIndex.search = (...args: Parameters<typeof segmentSearch>) => {
    segmentSearches++
    return segmentSearch(...args)
  }
  viaIndex.search = (...args: Parameters<typeof viaSearch>) => {
    viaSearches++
    return viaSearch(...args)
  }

  const node = { x: 0, y: 0, z: 1, g: 0, h: 0, f: 0, parent: null }
  expect(solver.isNodeTooCloseToObstacle(node, 0.1, true)).toBe(false)
  expect(solver.isNodeTooCloseToObstacle(node, 0.1, true)).toBe(false)
  expect(segmentSearches).toBe(1)
  expect(viaSearches).toBe(1)

  expect(solver.isNodeTooCloseToObstacle({ ...node, x: 0.5 }, 0.1, true)).toBe(
    false,
  )
  expect(segmentSearches).toBe(2)
  expect(viaSearches).toBe(2)
})

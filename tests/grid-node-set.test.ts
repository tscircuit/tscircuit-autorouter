import { expect, test } from "bun:test"
import { GridNodeSet } from "lib/data-structures/GridNodeSet"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("grid membership preserves Set semantics across bit boundaries and sparse keys", () => {
  const initial = new Set([0, 8, 32, -1, NaN])
  const grid = new GridNodeSet(33, new Set(initial))
  const reference = new Set(initial)
  const keys = [
    ...Array.from({ length: 40 }, (_, index) => index - 2),
    -0,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER,
    2 ** 32,
  ]
  for (const key of keys) expect(grid.has(key)).toBe(reference.has(key))
  for (const key of keys.toReversed()) {
    expect(grid.add(key)).toBe(grid)
    reference.add(key)
    for (const probe of keys) {
      expect(grid.has(probe)).toBe(reference.has(probe))
    }
    expect([...grid].length).toBe(reference.size)
    expect([...grid]).toEqual([...reference])
  }
  const params = {
    connectionName: "test-route",
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    A: { x: 1, y: 1, z: 0 },
    B: { x: 9, y: 9, z: 0 },
    obstacleRoutes: [],
    futureConnections: [
      {
        connectionName: "other-route",
        points: [
          { x: 1, y: 9, z: 1 },
          { x: 9, y: 1, z: 1 },
        ],
      },
    ],
    layerCount: 2,
    captureSearchDebug: false,
  }
  const solver = new SingleHighDensityRouteSolver(params)
  solver.step()
  const exposed = solver.exploredNodes
  expect(exposed).toBeInstanceOf(Set)
  expect(solver.exploredNodes).toBe(exposed)
  expect(exposed.size).toBeGreaterThan(0)
  exposed.clear()
  exposed.add(8).add(9).add(-1)
  expect([...solver.exploredNodes]).toEqual([8, 9, -1])
  expect(exposed.delete(8)).toBe(true)
  expect(solver.exploredNodes.has(8)).toBe(false)
  const replacement = new Set([0, 7, NaN])
  solver.exploredNodes = replacement
  expect(solver.exploredNodes).toBe(replacement)
  const observedBeforeSearch = new SingleHighDensityRouteSolver(params)
  const heldReference = observedBeforeSearch.exploredNodes
  observedBeforeSearch.step()
  expect(observedBeforeSearch.exploredNodes).toBe(heldReference)
  expect(heldReference.size).toBeGreaterThan(0)
  expect(() => new GridNodeSet(0)).toThrow()
  expect(() => new GridNodeSet(1.5)).toThrow()
  expect(() => new GridNodeSet(2 ** 32 + 1)).toThrow()
})

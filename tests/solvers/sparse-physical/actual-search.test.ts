import { expect, test } from "bun:test"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import { crossingWire, sparseOptions } from "./fixtures"

test("a real sparse graph realizes a clearance-safe path and finite graph failure remains Unknown", (): void => {
  const solver = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    availableZ: [0],
    obstacleRoutes: [crossingWire],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.sparseDiagnostics.expansions).toBeGreaterThan(1)
  const path = solver.solvedPath!.route
  expect(path[0]).toEqual(sparseOptions.A)
  expect(path[path.length - 1]).toEqual(sparseOptions.B)
  for (let i = 1; i < path.length; i++)
    expect(solver.isSparseEdgeLegal({ start: path[i - 1], end: path[i] })).toBe(
      true,
    )
  const blocked = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    availableZ: [0],
    obstacleRoutes: [
      {
        ...crossingWire,
        route: [
          { x: 5, y: 0, z: 0 },
          { x: 5, y: 10, z: 0 },
        ],
      },
    ],
  })
  blocked.solve()
  expect(blocked.failed).toBe(true)
  expect(blocked.solvedPath).toBeNull()
  expect(blocked.error).toContain("UNKNOWN")
})

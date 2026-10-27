import { expect, test } from "bun:test"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import { crossingWire, sparseOptions, throughVia } from "./fixtures"

test("sparse long edges reject finite-width capsules and interior via discs even with empty endpoints", (): void => {
  for (const obstacle of [crossingWire, throughVia]) {
    const solver = new SparsePhysicalSingleRouteSolver({
      ...sparseOptions,
      obstacleRoutes: [obstacle],
    })
    expect(
      solver.isSparseEdgeLegal({
        start: sparseOptions.A,
        end: sparseOptions.B,
      }),
    ).toBe(false)
    expect(
      solver.isSparseEdgeLegal({
        start: { x: 1, y: 2, z: 0 },
        end: { x: 9, y: 2, z: 0 },
      }),
    ).toBe(true)
  }
  const solver = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    obstacleRoutes: [crossingWire],
  })
  expect(
    solver.isSparseEdgeLegal({
      start: { x: 1, y: 2.6, z: 0 },
      end: { x: 9, y: 2.6, z: 0 },
    }),
  ).toBe(false)
  expect(
    solver.isSparseEdgeLegal({
      start: { x: 1, y: 2.3, z: 0 },
      end: { x: 9, y: 2.3, z: 0 },
    }),
  ).toBe(true)
})

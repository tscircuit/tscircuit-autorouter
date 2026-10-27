import { expect, test } from "bun:test"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import { sparseOptions } from "./fixtures"

test("only exact planar terminals receive boundary entry exemptions", (): void => {
  const A = { x: 0, y: 5, z: 0 }
  const solver = new SparsePhysicalSingleRouteSolver({ ...sparseOptions, A })
  expect(solver.isSparseEdgeLegal({ start: A, end: sparseOptions.B })).toBe(
    true,
  )
  expect(
    solver.isSparseEdgeLegal({
      start: { x: 0, y: 5.01, z: 0 },
      end: sparseOptions.B,
    }),
  ).toBe(false)
  expect(solver.isSparseEdgeLegal({ start: A, end: { ...A, z: 1 } })).toBe(
    false,
  )
  expect(
    solver.isSparseEdgeLegal({
      start: { x: 0.1, y: 1, z: 0 },
      end: { x: 0.1, y: 9, z: 0 },
    }),
  ).toBe(false)
  expect(
    solver.isSparseEdgeLegal({
      start: { x: -1, y: 5, z: 0 },
      end: sparseOptions.B,
    }),
  ).toBe(false)
})

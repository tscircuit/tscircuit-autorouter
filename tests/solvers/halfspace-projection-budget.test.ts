import { expect, test } from "bun:test"
import { HalfspaceProjectionSolver } from "lib/solvers/HalfspaceProjectionSolver"

test("general projection cap exhaustion returns unknown without a hard clause", (): void => {
  const solver = new HalfspaceProjectionSolver(2, [{
    terms: [{ variable: 0, coefficient: 1 }, { variable: 1, coefficient: 1 }],
    maximum: -0.1, family: 17,
  }], 0)
  solver.solve()
  expect(solver.getOutput()).toEqual({ status: "unknown", reason: "work-cap", residualFamilies: [17] })
  expect(solver.constraintChecks).toBe(0)
  expect(solver.stats.rowUpdates).toBe(0)
  expect(solver.stats.residualChecks).toBe(0)
})

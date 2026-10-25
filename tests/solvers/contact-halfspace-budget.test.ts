import { expect, test } from "bun:test"
import { ContactHalfspaceSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/ContactHalfspaceSolver"

test("bounded contradictory contact projection returns unknown without a feasibility claim", (): void => {
  const solver = new ContactHalfspaceSolver(1, [
    { terms: [{ variable: 0, coefficient: 1 }], maximum: -2, soft: false },
    { terms: [{ variable: 0, coefficient: -1 }], maximum: 1, soft: false },
  ], 1000, 7)
  solver.solve()
  expect(solver.getOutput().status).toBe("unknown")
  expect(solver.work).toBe(7)
  expect(solver.checks).toBe(1)
  expect(solver.failed).toBe(false)
})

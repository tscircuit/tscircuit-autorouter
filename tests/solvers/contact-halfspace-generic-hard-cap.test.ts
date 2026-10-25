import { expect, test } from "bun:test"
import { ContactHalfspaceSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/ContactHalfspaceSolver"

test("a capped proposal cannot bypass a generic coupled hard row", (): void => {
  const solver = new ContactHalfspaceSolver(2, [
    { terms: [{ variable: 0, coefficient: 1 }, { variable: 1, coefficient: 1 }], maximum: 0, soft: false },
    { terms: [{ variable: 0, coefficient: -1 }], maximum: -1, soft: true },
  ], 1000, 30)
  solver.solve()
  const result = solver.getOutput()
  expect(result.status).toBe("unknown")
  if (result.status !== "unknown") throw new Error("Unsafe generic hard-row proposal")
  expect(result.reason).toBe("hard-residual")
  expect(solver.work).toBeLessThanOrEqual(30)
  expect(solver.checks).toBeGreaterThan(0)
})

import { expect, test } from "bun:test"
import { ContactHalfspaceSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/ContactHalfspaceSolver"

test("a tiny cap cannot spend its checked-witness allowance on dual updates", (): void => {
  const solver = new ContactHalfspaceSolver(2, [{
    terms: [{ variable: 0, coefficient: 1 }, { variable: 1, coefficient: -1 }], maximum: -1, soft: true,
  }], 1000, 15)
  solver.solve()
  const result = solver.getOutput()
  expect(result.status).toBe("unknown")
  if (result.status !== "unknown") throw new Error("Unreserved witness was exported")
  expect(result.reason).toBe("work-cap")
  expect(solver.checks).toBe(0)
  expect(solver.work).toBeLessThanOrEqual(15)
})

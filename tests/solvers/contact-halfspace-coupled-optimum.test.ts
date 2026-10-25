import { expect, test } from "bun:test"
import { ContactHalfspaceSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/ContactHalfspaceSolver"

test("contact QP couples both owners at the analytic elastic minimum", (): void => {
  const solver = new ContactHalfspaceSolver(2, [{
    terms: [{ variable: 0, coefficient: 1 }, { variable: 1, coefficient: -1 }], maximum: -1, soft: true,
  }], 1000, 100)
  solver.solve()
  const result = solver.getOutput()
  expect(result.status).toBe("projected")
  if (result.status !== "projected") throw new Error("Missing checked QP displacement")
  const optimum = 1 / 2.001
  expect(result.displacement[0]).toBeCloseTo(-optimum, 10)
  expect(result.displacement[1]).toBeCloseTo(optimum, 10)
  expect(result.maximumSlack).toBeCloseTo(1 - 2 * optimum, 10)
})

import { expect, test } from "bun:test"
import { ContactHalfspaceSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/ContactHalfspaceSolver"

test("a work-capped elastic proposal has exact hard-box feasibility and explicit remaining soft slack", (): void => {
  const solver = new ContactHalfspaceSolver(2, [
    { terms: [{ variable: 0, coefficient: 1 }, { variable: 1, coefficient: -1 }], maximum: -1, soft: true },
    ...[0, 1].flatMap((variable) => [
      { terms: [{ variable, coefficient: 1 }], maximum: 0.1, soft: false },
      { terms: [{ variable, coefficient: -1 }], maximum: 0.1, soft: false },
    ]),
  ], 1000, 120)
  solver.solve()
  const result = solver.getOutput()
  if (result.status !== "projected") throw new Error("Missing checked capped proposal")
  expect(result.stopReason).toBe("work-cap")
  expect(result.stationary).toBe(false)
  expect(result.displacement[0]).toBeGreaterThanOrEqual(-0.1)
  expect(result.displacement[0]).toBeLessThanOrEqual(0.1)
  expect(result.displacement[1]).toBeGreaterThanOrEqual(-0.1)
  expect(result.displacement[1]).toBeLessThanOrEqual(0.1)
  expect(result.maximumSlack).toBeGreaterThanOrEqual(0.8 - 1e-12)
  expect(solver.checks).toBeGreaterThan(0)
  expect(solver.work).toBeLessThanOrEqual(120)
})

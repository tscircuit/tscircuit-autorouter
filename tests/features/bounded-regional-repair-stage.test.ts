import { expect, test } from "bun:test"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { BoundedRegionalRepairSolver } from "lib/solvers/BoundedRegionalRepairSolver/BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("the bounded repair stage clears a physical contact within the shared work budget", () => {
  const fixture = createBoundedRegionalRepairFixture()
  const original = structuredClone(fixture.routes)
  const solver = new BoundedRegionalRepairSolver({ ...fixture, colorMap: {} })
  expect(solver).toBeInstanceOf(BaseSolver)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.stats.candidateAttemptCount).toBeLessThanOrEqual(1024)
  expect(solver.stats.pathSearchNodeCount).toBeLessThanOrEqual(480_000)
  expect(fixture.routes).toEqual(original)
  const routes = solver.getOutput()
  expect(routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  const validation = fixture.drcEvaluator({ traces: [], routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
  expect(solver.visualize().lines!.length).toBeGreaterThan(0)
})

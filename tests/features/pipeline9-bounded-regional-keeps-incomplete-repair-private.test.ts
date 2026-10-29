import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("a regional improvement stays private while a reference connectivity error remains", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const original = structuredClone(fixture.routes)
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    drcEvaluator: (candidate) => {
      const reference = fixture.drcEvaluator(candidate)
      const errors = Array.isArray(reference) ? reference : reference.errors
      return {
        errors: [
          ...errors,
          { type: "pcb_trace_error", message: "Missing connection" },
        ],
        errorsWithCenters: Array.isArray(reference)
          ? reference
          : reference.errorsWithCenters,
      }
    },
  })
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  expect(result.acceptedRegionCount).toBeGreaterThan(0)
  expect(result.finalDrcIssueCount).toBe(1)
  expect(result.publishedDrcIssueCount).toBe(result.initialDrcIssueCount)
  expect(result.repaired).toBeFalse()
  expect(result.routes).toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(4)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(4 * 256)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(4 * 120_000)
})

import { getNewViaPadViolations } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional repair retains safe improvements and reports unresolved connectivity", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const original = structuredClone(fixture.routes)
  const result = applyPipeline9BoundedRegionalRepairs({
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
  expect(result.acceptedRegionCount).toBeGreaterThan(0)
  expect(result.finalDrcIssueCount).toBe(1)
  expect(result.repaired).toBeFalse()
  expect(result.routes).not.toBe(fixture.routes)
  const reference = fixture.drcEvaluator({ hdRoutes: result.routes })
  expect(Array.isArray(reference) ? reference : reference.errors).toEqual([])
  expect(result.routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(getNewViaPadViolations({
    srj: fixture.originalSrj,
    previousRoutes: fixture.routes,
    routes: result.routes,
  })).toEqual([])
  expect(fixture.routes).toEqual(original)
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(4)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(4 * 256)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(4 * 120_000)
})

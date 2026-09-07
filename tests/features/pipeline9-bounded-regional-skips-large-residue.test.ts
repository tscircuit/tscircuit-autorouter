import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded regional repair skips residue above eight reference errors", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const result = applyPipeline9BoundedRegionalRepairs({
    ...fixture,
    drcEvaluator: () =>
      Array.from({ length: 9 }, (_, index) => ({
        type: "pcb_trace_error",
        center: { x: index, y: 0 },
      })),
  })
  expect(result.routes).toBe(fixture.routes)
  expect(result.initialDrcIssueCount).toBe(9)
  expect(result.repaired).toBeFalse()
  expect(result.attemptedRegionCount).toBe(0)
  expect(result.candidateAttemptCount).toBe(0)
  expect(result.pathSearchNodeCount).toBe(0)
  expect(result.referenceValidationCount).toBe(1)
})

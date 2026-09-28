import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded regional repair leaves preloaded copper outside its supported scope", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.originalSrj.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "existing",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -4, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: -3, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const original = structuredClone(fixture.originalSrj)
  const result = applyPipeline9BoundedRegionalRepairs({
    ...fixture,
    drcEvaluator: () => {
      throw new Error("Unsupported copper must not reach the search")
    },
  })
  expect(result.routes).toBe(fixture.routes)
  expect(fixture.originalSrj).toEqual(original)
  expect(result.repaired).toBeFalse()
  expect(result.attemptedRegionCount).toBe(0)
  expect(result.referenceValidationCount).toBe(0)
})

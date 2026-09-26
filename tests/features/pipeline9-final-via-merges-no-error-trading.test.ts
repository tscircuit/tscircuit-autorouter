import { expect, test } from "bun:test"
import { applyPipeline9FinalViaMerges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9FinalViaMerges"
import { createIndependentViaMergeFixture } from "../fixtures/pipeline9-independent-via-merge-fixture"

test("fewer errors cannot justify a new error type or a missing connection", (): void => {
  for (const error of [
    { type: "pcb_pad_trace_clearance_error" },
    { type: "pcb_trace_error", pcb_trace_error_id: "missing_connection_power" },
  ]) {
    const fixture = createIndependentViaMergeFixture()
    const baseline = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
    let evaluations = 0
    const selected = applyPipeline9FinalViaMerges({
      ...fixture,
      drcEvaluator: (): typeof baseline => {
        evaluations++
        return evaluations === 1 ? baseline : { errors: [error] }
      },
    })
    expect(evaluations).toBeGreaterThan(1)
    expect(selected).toBe(fixture.routes)
  }
})

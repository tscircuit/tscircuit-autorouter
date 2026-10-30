import { expect, test } from "bun:test"
import { getPipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("duplicate raw identities and cross-kind actual IDs have no supported strict feedback credit", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const evaluated = fixture.evaluate(fixture.params.newHdRoutes)
  const trace = evaluated.native.circuitJson.find((element) => element.type === "pcb_trace")!
  if (trace.type !== "pcb_trace") throw new Error("Expected synthetic trace")
  for (const circuitJson of [
    [...evaluated.native.circuitJson, structuredClone(trace)],
    evaluated.native.circuitJson.map((element) => element.type === "pcb_via" ? { ...element, pcb_via_id: trace.pcb_trace_id } : element),
  ]) {
    const feedback = getPipeline9OriginalOwnerCopperFeedback({ originalSrj: fixture.params.originalSrj,
      srjWithPointPairs: fixture.params.srjWithPointPairs, routedTraces: evaluated.traces, circuitJson })
    expect(feedback.status).toBe("NOT_APPLICABLE")
    expect(feedback.errors).toEqual([])
  }
})

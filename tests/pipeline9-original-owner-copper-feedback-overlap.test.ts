import { expect, test } from "bun:test"
import { getPipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("a physically overlapping full-span via remains actionable when the clearance predicate suppresses its pair", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture(-0.1)
  const evaluated = fixture.evaluate(fixture.params.newHdRoutes)
  expect(evaluated.native.errors).toEqual([])
  const feedback = getPipeline9OriginalOwnerCopperFeedback({ originalSrj: fixture.params.originalSrj,
    srjWithPointPairs: fixture.params.srjWithPointPairs, routedTraces: evaluated.traces, circuitJson: evaluated.native.circuitJson })
  expect(feedback.status).toBe("SUPPORTED")
  expect(feedback.errors).toHaveLength(1)
  const error = feedback.errors[0]!
  expect(error.type).toBe("pcb_trace_error")
  expect(error.pcb_via_ids).toHaveLength(1)
  expect(error.pcb_trace_ids).toHaveLength(2)
  expect(error.pcb_trace_error_id).toBe(`overlap_${String(error.pcb_trace_id)}_${String(error.pcb_via_id)}`)
  expect(String(error.originalOwnerCopperFeedbackKey)).not.toContain('typedId')
})

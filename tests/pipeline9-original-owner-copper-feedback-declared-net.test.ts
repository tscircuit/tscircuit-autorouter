import { expect, test } from "bun:test"
import { getPipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("an explicit common original net retains legitimate same-owner equivalence", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  for (const srj of [fixture.params.originalSrj, fixture.params.srjWithPointPairs]) {
    for (const connection of srj.connections.slice(0, 2)) connection.__netConnectionName = "explicit_original_shared_net"
  }
  const evaluated = fixture.evaluate(fixture.params.newHdRoutes)
  const feedback = getPipeline9OriginalOwnerCopperFeedback({ originalSrj: fixture.params.originalSrj,
    srjWithPointPairs: fixture.params.srjWithPointPairs, routedTraces: evaluated.traces, circuitJson: evaluated.native.circuitJson })
  expect(feedback.status).toBe("SUPPORTED")
  expect(feedback.errors).toEqual([])
})

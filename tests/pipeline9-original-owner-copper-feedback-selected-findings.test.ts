import { expect, test } from "bun:test"
import { getPipeline9OriginalOwnerCopperFeedback, getPipeline9SelectedOriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("selected references retain exact admission findings, target identities and stable baseline keys across physical and ownership variants", (): void => {
  for (const gap of [0.06151, -0.1, 0.1, 0.1000000001]) {
    for (const blind of [false, true]) {
      const fixture = makeOriginalOwnerCopperFeedbackFixture(gap)
      fixture.params.originalSrj.allowBlindAndBuriedVias = blind
      fixture.params.srjWithPointPairs.allowBlindAndBuriedVias = blind
      const evaluated = fixture.evaluate(fixture.params.newHdRoutes)
      const input = { originalSrj: fixture.params.originalSrj, srjWithPointPairs: fixture.params.srjWithPointPairs,
        routedTraces: evaluated.traces, circuitJson: evaluated.native.circuitJson }
      expect(getPipeline9SelectedOriginalOwnerCopperFeedback(input)).toEqual(getPipeline9OriginalOwnerCopperFeedback(input))
      input.circuitJson = structuredClone(input.circuitJson).reverse().map((element) => element.type === "pcb_via" ?
        { ...element, pcb_via_id: `opaque_${element.pcb_via_id}_with_under_scores` } : element)
      expect(getPipeline9SelectedOriginalOwnerCopperFeedback(input)).toEqual(getPipeline9OriginalOwnerCopperFeedback(input))
      input.routedTraces[0]!.connection_name = "absent_original_owner"
      expect(getPipeline9SelectedOriginalOwnerCopperFeedback(input)).toEqual(getPipeline9OriginalOwnerCopperFeedback(input))
    }
  }
})

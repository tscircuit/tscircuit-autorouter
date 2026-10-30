import { expect, test } from "bun:test"
import { checkViaTraceClearance, checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { checkPipeline9SelectedOriginalIntentCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/checkPipeline9OriginalIntentCopper"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("selected references still reject every malformed declared clearance even when its predicate is not selected", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const evaluated = fixture.evaluate(fixture.params.newHdRoutes)
  for (const key of ["minViaEdgeToPadEdgeClearance", "minPadEdgeToPadEdgeClearance", "minTraceToPadEdgeClearance", "minViaHoleEdgeToViaHoleEdgeClearance"] as const) {
    for (const value of [-0.1, NaN, Infinity]) {
      const original = { ...fixture.params.originalSrj, [key]: value }
      expect(() => checkPipeline9SelectedOriginalIntentCopper({ original, pointPairs: fixture.params.srjWithPointPairs,
        traces: evaluated.traces, circuitJson: evaluated.native.circuitJson }, {
        viaTrace: checkViaTraceClearance, traceOverlap: checkEachPcbTraceNonOverlapping,
      })).toThrow(`Invalid original declared clearance: ${key}`)
    }
  }
})

import { expect, test } from "bun:test"
import { getPipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("declared blind via spans retain their real layers while the identical ordinary via occupies the full four-layer stack", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const full = fixture.evaluate(fixture.params.newHdRoutes)
  const check = (evaluated: typeof full): ReturnType<typeof getPipeline9OriginalOwnerCopperFeedback> =>
    getPipeline9OriginalOwnerCopperFeedback({ originalSrj: fixture.params.originalSrj, srjWithPointPairs: fixture.params.srjWithPointPairs,
      routedTraces: evaluated.traces, circuitJson: evaluated.native.circuitJson })
  expect(check(full).errors).toHaveLength(1)
  expect(full.native.circuitJson.find((element) => element.type === "pcb_via")).toMatchObject({ layers: ["top", "inner1", "inner2", "bottom"] })
  fixture.params.originalSrj.allowBlindAndBuriedVias = true
  fixture.params.srjWithPointPairs.allowBlindAndBuriedVias = true
  const blind = fixture.evaluate(fixture.params.newHdRoutes)
  expect(check(blind).status).toBe("SUPPORTED")
  expect(check(blind).errors).toEqual([])
  expect(blind.native.circuitJson.find((element) => element.type === "pcb_via")).toMatchObject({ layers: ["top", "inner1"] })
})

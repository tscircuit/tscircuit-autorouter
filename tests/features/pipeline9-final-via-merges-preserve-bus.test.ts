import { expect, test } from "bun:test"
import { applyPipeline9FinalViaMerges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9FinalViaMerges"
import { createIndependentViaMergeFixture } from "../fixtures/pipeline9-independent-via-merge-fixture"

test("independent via merging leaves a protected bus net unchanged", (): void => {
  const fixture = createIndependentViaMergeFixture()
  fixture.originalSrj.buses = [
    {
      busId: "protected_power",
      connectionNames: ["power_left", "power_right"],
    },
  ]
  const original = structuredClone(fixture.routes)
  const selected = applyPipeline9FinalViaMerges(fixture)
  expect(selected).toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
})

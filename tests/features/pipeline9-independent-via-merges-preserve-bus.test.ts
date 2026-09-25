import { expect, test } from "bun:test"
import { applyPipeline9IndependentViaMerges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9IndependentViaMerges"
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
  const selected = applyPipeline9IndependentViaMerges(fixture)
  expect(selected).toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
})

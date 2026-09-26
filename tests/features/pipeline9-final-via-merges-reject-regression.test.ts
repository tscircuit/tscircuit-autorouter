import { expect, test } from "bun:test"
import { applyPipeline9FinalViaMerges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9FinalViaMerges"
import { createIndependentViaMergeFixture } from "../fixtures/pipeline9-independent-via-merge-fixture"

test("final via cleanup never commits a proposal without reference DRC improvement", (): void => {
  const fixture = createIndependentViaMergeFixture()
  const original = structuredClone(fixture.routes)
  const reference = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  let evaluations = 0
  const selected = applyPipeline9FinalViaMerges({
    ...fixture,
    drcEvaluator: (): typeof reference => {
      evaluations++
      return reference
    },
  })
  expect(evaluations).toBeGreaterThan(1)
  expect(selected).toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
})

import { expect, test } from "bun:test"
import { applyPipeline9IndependentViaMerges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9IndependentViaMerges"
import { createIndependentViaMergeFixture } from "../fixtures/pipeline9-independent-via-merge-fixture"

test("merges same-net vias while an unrelated pad overlap remains unchanged", (): void => {
  const fixture = createIndependentViaMergeFixture()
  const original = structuredClone(fixture.routes)
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  const beforeErrors = Array.isArray(before) ? before : before.errors
  expect(beforeErrors).toHaveLength(2)
  expect(
    beforeErrors.some((error) => error.type === "pcb_via_clearance_error"),
  ).toBe(true)
  expect(beforeErrors.some((error) => error.type === "pcb_trace_error")).toBe(
    true,
  )

  const selected = applyPipeline9IndependentViaMerges(fixture)
  const after = fixture.drcEvaluator({ traces: [], routes: selected })
  const afterErrors = Array.isArray(after) ? after : after.errors
  expect(afterErrors).toEqual(
    beforeErrors.filter((error) => error.type !== "pcb_via_clearance_error"),
  )
  expect(selected[1]!.vias).toEqual(selected[2]!.vias)
  expect(selected[0]).toEqual(original[0])
  for (let i = 0; i < selected.length; i++) {
    expect(selected[i]!.route[0]).toEqual(original[i]!.route[0])
    expect(selected[i]!.route.at(-1)).toEqual(original[i]!.route.at(-1))
  }
  expect(fixture.routes).toEqual(original)
})

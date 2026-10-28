import { expect, test } from "bun:test"
import { Pipeline9FinalViaMergeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalViaMergeSolver"
import {
  createPipeline9ViaCoalescenceFixture,
  getPipeline9ViaCoalescenceInput,
} from "../fixtures/pipeline9-via-coalescence-fixture"

test("does not coalesce when every target would move a protected endpoint", (): void => {
  const fixture = createPipeline9ViaCoalescenceFixture({
    protectedViaEndpoints: true,
  })
  const original = structuredClone(fixture.routes)
  const input = getPipeline9ViaCoalescenceInput(fixture)
  expect(input.prepareReference(input.routes).errors).toHaveLength(1)
  const solver = new Pipeline9FinalViaMergeSolver(input)
  solver.solve()
  const result = solver.getResult()
  expect(result.repaired).toBe(false)
  expect(result.remainingDrcIssueCount).toBe(1)
  expect(result.routes).toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
})

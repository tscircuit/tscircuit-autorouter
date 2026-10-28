import { expect, test } from "bun:test"
import { Pipeline9FinalViaMergeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalViaMergeSolver"
import {
  createPipeline9ViaCoalescenceFixture,
  getPipeline9ViaCoalescenceInput,
} from "../fixtures/pipeline9-via-coalescence-fixture"

test("does not merge electrically distinct nets despite a physical via collision", (): void => {
  const fixture = createPipeline9ViaCoalescenceFixture({ distinctNets: true })
  const original = structuredClone(fixture.routes)
  const input = getPipeline9ViaCoalescenceInput(fixture)
  expect(input.prepareReference(input.routes).errors).toHaveLength(1)
  expect(fixture.connMap.areIdsConnected("branch_0", "branch_1")).toBe(false)
  const solver = new Pipeline9FinalViaMergeSolver(input)
  solver.solve()
  const result = solver.getResult()
  expect(result.repaired).toBe(false)
  expect(result.attempted).toBe(false)
  expect(result.routes).toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
})

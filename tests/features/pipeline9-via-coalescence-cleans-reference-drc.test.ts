import { expect, test } from "bun:test"
import { Pipeline9FinalViaMergeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalViaMergeSolver"
import {
  createPipeline9ViaCoalescenceFixture,
  getPipeline9ViaCoalescenceInput,
} from "../fixtures/pipeline9-via-coalescence-fixture"

test("coalesces near-coincident same-net interior vias with full reference DRC", (): void => {
  const fixture = createPipeline9ViaCoalescenceFixture()
  const original = structuredClone(fixture.routes)
  const input = getPipeline9ViaCoalescenceInput(fixture)
  expect(input.prepareReference(input.routes).errors).toHaveLength(1)
  expect(input.prepareReference(input.routes).errors[0]!.type).toBe(
    "pcb_via_clearance_error",
  )
  const solver = new Pipeline9FinalViaMergeSolver(input)
  solver.solve()
  const result = solver.getResult()
  expect(result.repaired).toBe(true)
  expect(result.attempted).toBe(true)
  expect(solver.merger).toBeDefined()
  expect(result.referenceValidationCount).toBeGreaterThan(0)
  expect(result.remainingDrcIssueCount).toBe(0)
  expect(fixture.evaluate(result.routes).errors).toHaveLength(0)
  expect(fixture.routes).toEqual(original)
  for (const [index, route] of result.routes.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.traceThickness).toBe(original[index]!.traceThickness)
    expect(route.viaDiameter).toBe(original[index]!.viaDiameter)
  }
})

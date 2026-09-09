import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded repair locates the physical pad when the DRC display marker is remote", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const drcEvaluator: DrcEvaluator = (input) => {
    const evaluated = fixture.drcEvaluator(input)
    if (Array.isArray(evaluated))
      throw new Error("Fixture requires centered errors")
    return {
      ...evaluated,
      errorsWithCenters: evaluated.errors.map((error) => ({
        ...error,
        pcb_pad_id: "foreign_pad",
        center: { x: 40, y: 40 },
      })),
    }
  }
  const result = applyPipeline9BoundedRegionalRepairs({
    ...fixture,
    drcEvaluator,
  })
  expect(result.initialDrcIssueCount).toBeGreaterThan(0)
  expect(result.repaired).toBeTrue()
  expect(result.finalDrcIssueCount).toBe(0)
  const validation = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
  expect(result.routes[0]!.route[0]).toEqual(fixture.routes[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(
    fixture.routes[0]!.route.at(-1),
  )
})

import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("total-budget exhaustion retains existing geometry and remaining DRC when a locally improved proposal fails full-board acceptance", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  let evaluations = 0
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    maxTotalCandidateAttempts: 1,
    referenceDrcEvaluator: () =>
      Array.from({ length: ++evaluations }, () => ({
        type: "reference_constraint",
        center: { x: 0, y: 0 },
      })),
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(evaluations).toBe(2)
  expect(solver.stats.completionReason).toBe("total-work-budget")
  expect(solver.stats.acceptedRegions).toBe(0)
  expect(solver.stats.candidateAttempts).toBe(1)
  expect(solver.stats.initialReferenceErrors).toBe(1)
  expect(solver.stats.referenceErrors).toBe(1)
  expect(solver.stats.indexedErrors).toBe(1)
  expect(solver.getOutput()).toBe(fixture.hdRoutes)
})

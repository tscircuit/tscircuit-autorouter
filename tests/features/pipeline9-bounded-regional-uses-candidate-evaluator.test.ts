import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded regional repair reserves reference DRC for candidate validation", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  let projectionEvaluationCount = 0
  let referenceValidationCount = 0
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    drcEvaluator: (input) => {
      referenceValidationCount++
      return fixture.drcEvaluator(input)
    },
    projectionDrcEvaluator: (input) => {
      projectionEvaluationCount++
      return fixture.drcEvaluator(input)
    },
  })

  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.failed).toBeFalse()
  const result = solver.getResult()
  expect(result.repaired).toBeTrue()
  expect(result.finalDrcIssueCount).toBe(0)
  expect(result.referenceValidationCount).toBe(referenceValidationCount)
  expect(result.projectionEvaluationCount).toBe(projectionEvaluationCount)
  expect(result.projectionEvaluationCount).toBeGreaterThan(0)
})

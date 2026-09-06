import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("reference-clean repair returns unchanged copper without constructing indexed search state", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  fixture.srj.obstacles.splice(0)
  const before = structuredClone(fixture.hdRoutes)
  const evaluateReference = fixture.referenceDrcEvaluator
  let referenceCalls = 0
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    maxTotalCandidateAttempts: 32_768,
    fullEffortReferenceErrorCount: 16,
    referenceDrcEvaluator: (input): ReturnType<typeof evaluateReference> => {
      referenceCalls++
      return evaluateReference(input)
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(referenceCalls).toBe(1)
  expect(solver.getOutput()).toBe(fixture.hdRoutes)
  expect(solver.getOutput()).toEqual(before)
  expect(solver.stats).toMatchObject({
    completionReason: "clean",
    referenceErrors: 0,
    indexedErrors: null,
    initialReferenceErrors: 0,
    candidateAttempts: 0,
    regions: 0,
  })
  const searchState = solver as unknown as {
    engine: unknown
    fixedViolations: unknown
  }
  expect(searchState.engine).toBeNull()
  expect(searchState.fixedViolations).toBeNull()
})

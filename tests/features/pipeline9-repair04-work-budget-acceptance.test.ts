import type { Repair04Solver } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("only a retained full-board improvement replenishes the work allowance", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    maxRegions: 2,
    maxInitialCandidateAttempts: 1,
    maxCandidateAttemptsSinceAcceptance: 2,
    referenceDrcEvaluator: (
      input,
    ): ReturnType<typeof fixture.referenceDrcEvaluator> => {
      const result = fixture.referenceDrcEvaluator(input)
      const errors = Array.isArray(result) ? result : result.errors
      return [
        ...errors,
        { type: "remaining_constraint", center: { x: 100, y: 100 } },
      ]
    },
  })
  while (!solver.solved && !solver.failed && !solver.stats.acceptedRegions)
    solver.step()
  expect(solver.failed).toBe(false)
  expect(solver.stats.acceptedRegions).toBe(1)
  expect(solver.stats.candidateAttempts).toBe(1)
  expect(solver.stats.attemptsSinceAcceptance).toBe(0)
  expect(solver.stats.nodesSinceAcceptance).toBe(0)
  const child = (solver as unknown as { localSolver: Repair04Solver })
    .localSolver
  expect(child.getConstructorParams()[0].maxCandidateAttempts).toBe(2)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.completionReason).toBe("region-budget")
  expect(solver.stats.referenceErrors).toBe(1)
  expect(solver.getOutput()).not.toEqual(fixture.hdRoutes)
})

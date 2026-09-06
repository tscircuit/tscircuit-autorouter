import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("unconfigured stages preserve the original untracked child allowance and omit total-budget statistics", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const solver = new Pipeline9Repair04Solver({ ...fixture, enabled: true })
  solver.step()
  const child = (
    solver as unknown as {
      localSolver: {
        getConstructorParams(): [{ maxCandidateAttempts?: number }]
      }
    }
  ).localSolver
  expect(child.getConstructorParams()[0].maxCandidateAttempts).toBeUndefined()
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.completionReason).toBe("clean")
  expect(solver.stats.referenceErrors).toBe(0)
  expect(Object.hasOwn(solver.stats, "initialReferenceErrors")).toBe(false)
  expect(
    Object.hasOwn(solver.stats, "effectiveMaxTotalCandidateAttempts"),
  ).toBe(false)
  expect(Object.hasOwn(solver.stats, "candidateAttempts")).toBe(false)
})

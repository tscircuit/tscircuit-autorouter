import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("repair work limits validate input and do not hide checker failures", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  for (const name of [
    "maxCandidateAttemptsSinceAcceptance",
    "maxInitialCandidateAttempts",
    "maxPathSearchNodesSinceAcceptance",
    "maxPathSearchNodesPerRegion",
  ]) {
    for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        () => new Pipeline9Repair04Solver({ ...fixture, enabled: true, [name]: limit }),
      ).toThrow(`${name} must be a positive safe integer`)
    }
  }
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    enabled: true,
    maxCandidateAttemptsSinceAcceptance: 1,
    referenceDrcEvaluator: (): never => {
      throw new Error("Unexpected checker failure")
    },
  })
  expect(() => solver.solve()).toThrow("Unexpected checker failure")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutput()).toThrow("before completed stage")
})

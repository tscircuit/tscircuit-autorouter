import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("empty crops charge zero work and malformed completed-child statistics fail closed", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const makeSolver = (): Pipeline9Repair04Solver =>
    new Pipeline9Repair04Solver({
      ...fixture,
      maxRegions: 2,
      maxInitialCandidateAttempts: 1,
      maxCandidateAttemptsSinceAcceptance: 2,
      referenceDrcEvaluator: (): ReturnType<
        typeof fixture.referenceDrcEvaluator
      > => [
        {
          type: "out_of_crop_reference_constraint",
          center: { x: 100, y: 100 },
        },
      ],
    })
  const empty = makeSolver()
  empty.solve()
  expect(empty.failed).toBe(false)
  expect(empty.stats.regions).toBe(2)
  expect(empty.stats.acceptedRegions).toBe(0)
  expect(empty.stats.candidateAttempts).toBe(0)
  expect(empty.stats.pathSearchNodes).toBe(0)
  expect(empty.stats.pathSearchCalls).toBe(0)
  expect(empty.stats.attemptsSinceAcceptance).toBe(0)
  expect(empty.stats.nodesSinceAcceptance).toBe(0)
  expect(empty.stats.completionReason).toBe("region-budget")
  expect(empty.getOutput()).toBe(fixture.hdRoutes)

  // Deliberate statistics corruption occurs only after a real child has
  // completed. This proves missing/incompatible accounting cannot silently
  // disable the parent limits or turn a checker integration error into a pass.
  for (const name of [
    "candidateAttempts",
    "pathSearchNodes",
    "pathSearchCalls",
  ]) {
    for (const invalid of [
      undefined,
      null,
      "1",
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const malformed = makeSolver()
      malformed.step()
      const child = (
        malformed as unknown as {
          localSolver: {
            solve(): void
            solved: boolean
            stats: Record<string, unknown>
          }
        }
      ).localSolver
      child.solve()
      expect(child.solved).toBe(true)
      child.stats[name] = invalid
      expect(() => malformed.step()).toThrow(`invalid completed child ${name}`)
      expect(malformed.failed).toBe(true)
      expect(malformed.solved).toBe(false)
      expect(() => malformed.getOutput()).toThrow("before completed stage")
    }
  }
})

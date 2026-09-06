import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("total-work configuration rejects invalid limits and a scaling threshold without a total budget", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  for (const name of [
    "maxTotalCandidateAttempts",
    "fullEffortReferenceErrorCount",
  ] as const) {
    for (const limit of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        () =>
          new Pipeline9Repair04Solver({
            ...fixture,
            enabled: true,
            maxTotalCandidateAttempts: 10,
            [name]: limit,
          }),
      ).toThrow(`${name} must be a positive safe integer`)
    }
  }
  expect(
    () =>
      new Pipeline9Repair04Solver({
        ...fixture,
        enabled: true,
        fullEffortReferenceErrorCount: 16,
      }),
  ).toThrow("fullEffortReferenceErrorCount requires maxTotalCandidateAttempts")
  const disabled = new Pipeline9Repair04Solver({
    ...fixture,
    enabled: false,
    maxTotalCandidateAttempts: 10,
    fullEffortReferenceErrorCount: 16,
    referenceDrcEvaluator: (): never => {
      throw new Error("Disabled stage must not call DRC")
    },
  })
  disabled.solve()
  expect(disabled.stats.completionReason).toBe("disabled")
  expect(disabled.stats.initialReferenceErrors).toBeNull()
  expect(disabled.stats.effectiveMaxTotalCandidateAttempts).toBeNull()
  expect(disabled.getOutput()).toBe(fixture.hdRoutes)
})

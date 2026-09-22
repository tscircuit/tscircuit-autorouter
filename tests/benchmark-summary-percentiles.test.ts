import { expect, test } from "bun:test"
import type { WorkerResult } from "../scripts/benchmark/benchmark-types"
import { summarizeSolverResults } from "../scripts/benchmark/index"

test("benchmark timing percentiles count failures at each sample timeout", () => {
  const solverName = "AutoroutingPipelineSolver7_MultiGraph"
  const makeResult = (
    sampleNumber: number,
    elapsedTimeMs: number,
    overrides: Partial<WorkerResult> = {},
  ): WorkerResult => ({
    solverName,
    scenarioName: `sample${sampleNumber}`,
    sampleNumber,
    elapsedTimeMs,
    sampleTimeoutMs: 1_000,
    didSolve: true,
    didTimeout: false,
    relaxedDrcPassed: true,
    ...overrides,
  })
  const results = [
    makeResult(1, 100),
    makeResult(2, 200),
    makeResult(3, 300),
    makeResult(4, 400),
    makeResult(5, 1_000, {
      didSolve: false,
      didTimeout: true,
      relaxedDrcPassed: false,
    }),
    makeResult(6, 10, {
      didSolve: false,
      relaxedDrcPassed: false,
      error: "failed before routing",
      sampleTimeoutMs: 2_000,
    }),
  ]

  const summary = summarizeSolverResults(solverName, results)
  expect(summary.p50TimeMs).toBe(350)
  expect(summary.p60TimeMs).toBeCloseTo(400)
  expect(summary.p70TimeMs).toBeCloseTo(700)
  expect(summary.p80TimeMs).toBeCloseTo(1_000)
  expect(summary.p90TimeMs).toBeCloseTo(1_500)
  expect(summary.p95TimeMs).toBeCloseTo(1_750)
  expect(summary.completedRateLabel).toBe("66.7% (🕒16.7%)")
  expect(summary.timedOutLabel).toBe("1/6")
  expect(summarizeSolverResults(solverName, results.slice(4)).p50TimeMs).toBe(
    1_500,
  )
  expect(results[5].elapsedTimeMs).toBe(10)
  expect(results[5].didTimeout).toBe(false)
  expect(summarizeSolverResults(solverName, []).p50TimeMs).toBeNull()
  expect(() =>
    summarizeSolverResults(solverName, [
      makeResult(7, 5, { didSolve: false, sampleTimeoutMs: undefined }),
    ]),
  ).toThrow("Missing or invalid sample timeout")
})

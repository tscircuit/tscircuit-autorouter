import { expect, test } from "bun:test"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("thread comparisons reject mismatched runs instead of combining incomparable data", (): void => {
  const input = {
    baseReport: createThreadComparisonReport(1_000, 1),
    prReport: createThreadComparisonReport(2_000, 1),
    threaded: {
      threads: 4,
      baseReport: createThreadComparisonReport(400, 4),
      prReport: createThreadComparisonReport(500, 4),
    },
    baseSha: "a".repeat(40),
    prSha: "b".repeat(40),
    repository: "tscircuit/tscircuit-autorouter",
    runnerName: "test-runner",
  }
  for (const threads of [1, 0, 1.5, NaN, Infinity]) {
    expect(() =>
      renderSameMachineBenchmarkResults({
        ...input,
        threaded: { ...input.threaded, threads },
      }),
    ).toThrow("thread count above one")
  }
  for (const key of ["datasetName", "effortLabel", "scenarioCount"] as const) {
    const broken = structuredClone(input)
    Object.assign(broken.threaded.prReport, { [key]: "different" })
    expect(() => renderSameMachineBenchmarkResults(broken)).toThrow(
      "metadata mismatch",
    )
  }
  const missing = structuredClone(input)
  missing.threaded.prReport.tests = []
  expect(() => renderSameMachineBenchmarkResults(missing)).toThrow(
    "samples or solvers mismatch",
  )
  const wrongThreads = structuredClone(input)
  wrongThreads.threaded.prReport.runtime!.threadsPerSample = 8
  expect(() => renderSameMachineBenchmarkResults(wrongThreads)).toThrow(
    "Thread count mismatch",
  )
  const wrongSerial = structuredClone(input)
  wrongSerial.prReport.runtime!.threadsPerSample = 4
  expect(() => renderSameMachineBenchmarkResults(wrongSerial)).toThrow(
    "Thread count mismatch",
  )
})

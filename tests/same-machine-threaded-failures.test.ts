import { expect, test } from "bun:test"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("threaded failures use timeout scoring and retain threaded outcome changes", (): void => {
  const baseThreaded = createThreadComparisonReport(400, 4)
  const prThreaded = createThreadComparisonReport(500, 4)
  baseThreaded.tests[0]!.didSolve = false
  baseThreaded.tests[0]!.didTimeout = true
  baseThreaded.tests[0]!.relaxedDrcPassed = false
  baseThreaded.summary[0]!.completedRateLabel = "0.0%"
  const input = {
    baseReport: createThreadComparisonReport(1_000, 1),
    prReport: createThreadComparisonReport(2_000, 1),
    threaded: { threads: 4, baseReport: baseThreaded, prReport: prThreaded },
    baseSha: "a".repeat(40),
    prSha: "b".repeat(40),
    repository: "tscircuit/tscircuit-autorouter",
    runnerName: "test-runner",
  }
  const markdown = renderSameMachineBenchmarkResults(input)
  expect(markdown).toContain(
    "| Pipeline9 | P50 time | 1.0s | 2.0s | 10.0s | 500ms |",
  )
  expect(markdown).toContain("| Pipeline9 | Timeouts | 0 | 0 | 1 | 0 |")
  expect(markdown).toContain(
    "Threaded outcome changes (4T): **1 improved**, **0 regressed**.",
  )
  expect(markdown).toContain(
    "| Solver | Sample | Base (4T) | PR (4T) | Base time | PR time | Delta |",
  )
  baseThreaded.tests[0]!.didTimeout = false
  expect(renderSameMachineBenchmarkResults(input)).toContain(
    "| Pipeline9 | P50 time | 1.0s | 2.0s | 10.0s | 500ms |",
  )
  delete baseThreaded.tests[0]!.sampleTimeoutMs
  expect(renderSameMachineBenchmarkResults(input)).toContain(
    "| Pipeline9 | P50 time | 1.0s | 2.0s | n/a | 500ms |",
  )
})

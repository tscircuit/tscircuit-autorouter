import { expect, test } from "bun:test"
import type { WorkerResult } from "../scripts/benchmark/benchmark-types"
import { summarizeSolverResults } from "../scripts/benchmark/index"
import { averageTraceLintIssues, formatTraceLintTable } from "../scripts/benchmark/trace-lint-metrics.js"

test("benchmark style averages include zero-error runs and exclude failed or unmeasured runs", () => {
  const result: WorkerResult = {
    solverName: "Pipeline9", scenarioName: "example", sampleNumber: 1,
    elapsedTimeMs: 20, sampleTimeoutMs: 1000,
    didSolve: true, didTimeout: false, relaxedDrcPassed: true,
  }
  const results: WorkerResult[] = [
    { ...result, traceLintIssueCounts: { odd_angle: 6, future_rule: 2 } },
    { ...result, traceLintIssueCounts: { odd_angle: 0, future_rule: 0 } },
    { ...result, didSolve: false, traceLintIssueCounts: { odd_angle: 999 } },
    { ...result, didTimeout: true, didSolve: false },
    result,
  ]
  const summary = summarizeSolverResults("Pipeline9", results)
  expect(summary.avgTraceLintIssues).toEqual({ odd_angle: 3, future_rule: 1 })
  expect(averageTraceLintIssues([result])).toEqual({ odd_angle: null })
  expect(averageTraceLintIssues([])).toEqual({ odd_angle: null })
  expect(averageTraceLintIssues([{ ...result, traceLintIssueCounts: { odd_angle: 0 } }])).toEqual({ odd_angle: 0 })
  expect(() => averageTraceLintIssues([{ ...result, traceLintIssueCounts: { odd_angle: -1 } }])).toThrow("Invalid trace lint count")
  expect(formatTraceLintTable([summary])).toContain("| Avg Angled Traces | 3.00 |")
  expect(formatTraceLintTable([summary])).toContain("| Avg future_rule | 1.00 |")
})

import { expect, test } from "bun:test"
import { renderEffortComparison } from "../scripts/benchmark/effort-comparison"
import type {
  BenchmarkReport,
  WorkerResult,
} from "../scripts/benchmark/benchmark-types"

test("effort comparison excludes failures from paired vias but reports them", (): void => {
  const runs = [1, 1.5, 2].map((effort) => ({
    effort,
    report: {
      tests: [
        {
          solverName: "pipeline9",
          scenarioName: "sample1",
          sampleNumber: 1,
          didSolve: true,
          relaxedDrcPassed: true,
          didTimeout: false,
          viaCount: 12 - effort * 2,
          elapsedTimeMs: 1000,
        },
        {
          solverName: "pipeline9",
          scenarioName: "sample2",
          sampleNumber: 2,
          didSolve: effort === 1,
          relaxedDrcPassed: effort === 1,
          didTimeout: effort !== 1,
          viaCount: effort === 1 ? 100 : undefined,
          elapsedTimeMs: 2000,
        },
      ] as WorkerResult[],
    } as BenchmarkReport,
  }))
  const output = renderEffortComparison(runs)
  expect(output).toContain("the 1 samples")
  expect(output).toContain("| 1x | 2/2 | 2/2 | 0 | 10 | 0 | 1.0 |")
  expect(output).toContain("| 1.5x | 1/2 | 1/2 | 1 | 9 | -1 | 1.0 |")
  expect(output).toContain("| 2x | 1/2 | 1/2 | 1 | 8 | -2 | 1.0 |")
})

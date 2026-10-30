import { expect, test } from "bun:test"
import { validateFourThreadComparison } from "../scripts/benchmark/renderFourThreadComparison"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("four-thread comparison requires matching full dataset and routing budgets", (): void => {
  const base = createThreadComparisonReport(1_000, 4)
  base.scenarioCount = 16
  base.tests = Array.from({ length: 16 }, (_, index) => ({
    ...base.tests[0]!,
    sampleNumber: index + 1,
    scenarioName: `sample${String(index + 1).padStart(3, "0")}`,
  }))
  const candidate = structuredClone(base)
  expect(() => validateFourThreadComparison(base, candidate)).not.toThrow()
  const missing = structuredClone(candidate)
  missing.tests.pop()
  expect(() => validateFourThreadComparison(base, missing)).toThrow(
    "full Pipeline9 dataset18",
  )
  const wrongThreads = structuredClone(candidate)
  wrongThreads.runtime!.effectiveThreadsPerSample = 1
  expect(() => validateFourThreadComparison(base, wrongThreads)).toThrow(
    "four routing threads",
  )
  const wrongTimeout = structuredClone(candidate)
  wrongTimeout.tests[0]!.sampleTimeoutMs = 42
  expect(() => validateFourThreadComparison(base, wrongTimeout)).toThrow(
    "configurations do not match",
  )
})

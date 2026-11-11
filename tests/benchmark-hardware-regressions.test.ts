import { expect, test } from "bun:test"
import {
  buildSummaryEntryMap,
  DEFAULT_THRESHOLDS,
  detectRegressions,
} from "../scripts/benchmark/detect-benchmark-regressions"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("timing regressions require matching hardware while quality regressions remain visible", () => {
  const baseline = createThreadComparisonReport(1_000, 1)
  const current = createThreadComparisonReport(2_000, 1)
  current.runtime!.cpuModel = "different CPU"
  current.summary[0].completedRateLabel = "90.0%"
  const compare = (): ReturnType<typeof detectRegressions> =>
    detectRegressions({
      baseline: buildSummaryEntryMap([baseline], "baseline"),
      current: buildSummaryEntryMap([current], "current"),
      thresholds: DEFAULT_THRESHOLDS,
      baselineMissing: false,
    })
  let result = compare()
  expect(
    result.regressions.some((entry) => entry.metric === "completedRate"),
  ).toBe(true)
  expect(result.regressions.some((entry) => entry.metric === "p50TimeMs")).toBe(
    false,
  )
  expect(result.skippedTimingComparisons).toHaveLength(1)
  current.runtime = baseline.runtime
  result = compare()
  expect(result.regressions.some((entry) => entry.metric === "p50TimeMs")).toBe(
    true,
  )
  expect(result.skippedTimingComparisons).toHaveLength(0)
  delete current.runtime
  result = compare()
  expect(result.skippedTimingComparisons).toHaveLength(1)
  expect(result.regressions.some((entry) => entry.metric === "p95TimeMs")).toBe(
    false,
  )
})

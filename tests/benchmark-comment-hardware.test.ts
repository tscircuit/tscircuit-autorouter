import { expect, test } from "bun:test"
import { renderBenchmarkComparison } from "../scripts/benchmark/benchmark-comment-comparison.js"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("PR comments show raw times without a percentage change for incompatible hardware", () => {
  const mainReport = createThreadComparisonReport(1_000, 1)
  const prReport = createThreadComparisonReport(1_200, 1)
  prReport.runtime!.cpuModel = "different CPU"
  let text = renderBenchmarkComparison({ mainReport, prReport }).join("\n")
  expect(text).toContain(
    "| P50 time | 1.0s | 1.2s | n/a (hardware differs or is unrecorded) |",
  )
  expect(text).toContain("| Completion | 100.0% | 100.0% | 0.0 pp |")
  prReport.runtime = mainReport.runtime
  text = renderBenchmarkComparison({ mainReport, prReport }).join("\n")
  expect(text).toContain("| P50 time | 1.0s | 1.2s | +20.0% |")
  delete prReport.runtime
  text = renderBenchmarkComparison({ mainReport, prReport }).join("\n")
  expect(text).toContain("n/a (hardware differs or is unrecorded)")
})

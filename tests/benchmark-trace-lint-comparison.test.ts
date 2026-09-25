import { expect, test } from "bun:test"
import type {
  BenchmarkReport,
  SolverRunSummary,
} from "../scripts/benchmark/benchmark-types"
import { renderBenchmarkComparison } from "../scripts/benchmark/benchmark-comment-comparison.js"

test("benchmark comparisons render a row per style issue type with historical n/a and cold/hot support", () => {
  const summary: SolverRunSummary = {
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    completedRateLabel: "100%",
    relaxedDrcRateLabel: "100%",
    timedOutLabel: "0/1",
    p50TimeMs: 1,
    p95TimeMs: 1,
    avgVia: 0,
  }
  const report: BenchmarkReport = {
    version: 1,
    datasetName: "srj18",
    scenarioCount: 1,
    effortLabel: "1x effort",
    summary: [summary],
    tests: [],
    snapshots: [],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
  }
  const mainReport = {
    ...report,
    summary: [
      { ...summary, avgTraceLintIssues: { odd_angle: 4, future_rule: 2 } },
    ],
  }
  const prReport = {
    ...report,
    summary: [
      { ...summary, avgTraceLintIssues: { odd_angle: 2, future_rule: 1 } },
    ],
  }
  const text = renderBenchmarkComparison({ mainReport, prReport }).join("\n")
  expect(text).toContain(
    "| Pipeline9 | Avg Angled Traces | 4.00 | 2.00 | -50.0% |",
  )
  expect(text).toContain(
    "| Pipeline9 | Avg future_rule | 2.00 | 1.00 | -50.0% |",
  )
  expect(
    renderBenchmarkComparison({ mainReport: report, prReport }).join("\n"),
  ).toContain("| Pipeline9 | Avg Angled Traces | n/a | 2.00 | n/a |")
  const coldHot = {
    ...report,
    summary: [
      {
        ...summary,
        solverName: "Pipeline9_Networked Cold",
        avgTraceLintIssues: { odd_angle: 2 },
      },
      {
        ...summary,
        solverName: "Pipeline9_Networked Hot",
        avgTraceLintIssues: { odd_angle: 0 },
      },
    ],
  }
  expect(
    renderBenchmarkComparison({ mainReport: null, prReport: coldHot }).join(
      "\n",
    ),
  ).toContain("| Avg Angled Traces | 2.00 | 0.00 | -100.0% |")
})

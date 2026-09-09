import { expect, test } from "bun:test"
import type {
  BenchmarkReport,
  WorkerResult,
} from "../scripts/benchmark/benchmark-types"
import { renderBenchmarkStageTimings } from "../scripts/benchmark/renderBenchmarkStageTimings.js"
import { renderBenchmarkComparison } from "../scripts/benchmark/benchmark-comment-comparison.js"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"

test("benchmark comments total stage timings by solver and report, including partial samples", () => {
  const makeSample = (
    solverName: string,
    status: "complete" | "partial",
    times: number[],
  ): WorkerResult => ({
    solverName,
    scenarioName: "sample",
    sampleNumber: 1,
    elapsedTimeMs: 10_000,
    didSolve: status === "complete",
    didTimeout: status === "partial",
    relaxedDrcPassed: false,
    stageTiming: {
      status,
      stages: times.map((elapsedTimeMs, index) => ({
        stageName: ["fanout", "routing"][index]!,
        elapsedTimeMs,
      })),
    },
  })
  const report: BenchmarkReport = {
    version: 1,
    datasetName: "srj18",
    scenarioCount: 3,
    effortLabel: "1x effort",
    summary: [
      {
        solverName: "Pipeline9",
        completedRateLabel: "50%",
        relaxedDrcRateLabel: "0%",
        timedOutLabel: "1/2",
        p50TimeMs: 10_000,
        p95TimeMs: 10_000,
        avgVia: 0,
      },
    ],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: [
      makeSample("Pipeline9", "complete", [1000, 2000]),
      makeSample("Pipeline9", "partial", [500, 2500]),
    ],
  }
  report.tests.push({
    ...makeSample("Pipeline9", "complete", []),
    stageTiming: undefined,
  })
  const details = renderBenchmarkStageTimings(report, "PR").join("\n")
  expect(details).toContain(
    "<details>\n<summary>PR pipeline stage timings</summary>\n\n",
  )
  expect(details).toContain("2/3 samples (1 partial")
  expect(details).toContain("| fanout | 1.500s | 25.0% |")
  expect(details).toContain("| routing | 4.500s | 75.0% |")
  expect(details).toContain("| **Total** | **6.000s** | **100.0%** |")
  expect(details).toEndWith("\n\n</details>")
  const mainReport = {
    ...report,
    tests: [makeSample("Pipeline9", "complete", [100, 900])],
  }
  for (const markdown of [
    renderBenchmarkComparison({ mainReport, prReport: report }).join("\n"),
    renderSameMachineBenchmarkResults({
      mainReport,
      prReport: report,
      mainSha: "a",
      prSha: "b",
      repository: "tscircuit/tscircuit-autorouter",
      runnerName: "test",
    }),
  ]) {
    expect(markdown).toContain("<summary>Main pipeline stage timings</summary>")
    expect(markdown).toContain("| fanout | 0.100s | 10.0% |")
    expect(markdown).toContain(details)
  }
  const coldHotReport = {
    ...report,
    summary: [
      { ...report.summary[0]!, solverName: "Pipeline9_Networked Cold" },
      { ...report.summary[0]!, solverName: "Pipeline9_Networked Hot" },
    ],
    tests: [
      makeSample("Pipeline9_Networked Cold", "complete", [1000, 3000]),
      makeSample("Pipeline9_Networked Hot", "complete", [1000, 1000]),
    ],
  }
  const coldHot = renderBenchmarkComparison({
    mainReport: null,
    prReport: coldHotReport,
  }).join("\n")
  expect(coldHot).toContain(
    "<summary>Cold/hot pipeline stage timings</summary>",
  )
  expect(coldHot).toContain("| fanout | 1.000s | 25.0% |")
  expect(coldHot).toContain("| fanout | 1.000s | 50.0% |")
  const zero = renderBenchmarkStageTimings(
    { ...report, tests: [makeSample("<Pipeline|9>", "complete", [0, 0])] },
    "PR",
  ).join("\n")
  expect(zero).toContain("&lt;Pipeline&#124;9&gt;")
  expect(zero).toContain("| fanout | 0.000s | n/a |")
  expect(zero).not.toMatch(/NaN|Infinity/)
  expect(renderBenchmarkStageTimings(null, "Main").join("\n")).toContain(
    "Stage timings unavailable",
  )
  expect(
    renderBenchmarkStageTimings(
      { ...report, tests: [report.tests[2]!] },
      "PR",
    ).join("\n"),
  ).toContain("Stage timings unavailable")
})

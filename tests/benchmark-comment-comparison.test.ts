import { expect, test } from "bun:test"
import type {
  BenchmarkReport,
  WorkerResult,
} from "../scripts/benchmark/benchmark-types"
import { renderBenchmarkComparison } from "../scripts/benchmark/benchmark-comment-comparison.js"

test("PR benchmark comments render one main-versus-PR comparison table", () => {
  const solverName = "AutoroutingPipelineSolver7_MultiGraph"
  const makeTest = (
    sampleNumber: number,
    elapsedTimeMs: number,
    overrides: Partial<WorkerResult> = {},
  ): WorkerResult => ({
    solverName,
    scenarioName: `sample${sampleNumber}`,
    sampleNumber,
    elapsedTimeMs,
    sampleTimeoutMs: 2_000,
    didSolve: true,
    didTimeout: false,
    relaxedDrcPassed: true,
    ...overrides,
  })
  const makeReport = (
    summary: BenchmarkReport["summary"],
    tests: WorkerResult[],
  ): BenchmarkReport => ({
    version: 1,
    datasetName: "srj18",
    scenarioCount: 2,
    effortLabel: "1x effort",
    summary,
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests,
  })
  const mainReport = makeReport(
    [
      {
        solverName,
        completedRateLabel: "50.0% (🕒50.0%)",
        relaxedDrcRateLabel: "0.0% (🕒50.0%)",
        timedOutLabel: "1/2",
        p50TimeMs: 1_000,
        p95TimeMs: 1_000,
        avgPeakRssBytes: 100 * 1024 * 1024,
        p50PeakRssBytes: 90 * 1024 * 1024,
        p95PeakRssBytes: 110 * 1024 * 1024,
        maxPeakRssBytes: 120 * 1024 * 1024,
        avgVia: 2,
      },
    ],
    [
      makeTest(1, 1_000, {
        relaxedDrcPassed: false,
        drcErrorCount: 3,
      }),
      makeTest(2, 2_000, {
        didSolve: false,
        didTimeout: true,
        relaxedDrcPassed: false,
      }),
    ],
  )
  const prReport = makeReport(
    [
      {
        solverName,
        completedRateLabel: "100.0%",
        relaxedDrcRateLabel: "50.0%",
        timedOutLabel: "0/2",
        p50TimeMs: 1_350,
        p95TimeMs: 1_755,
        avgPeakRssBytes: 80 * 1024 * 1024,
        p50PeakRssBytes: 72 * 1024 * 1024,
        p95PeakRssBytes: 88 * 1024 * 1024,
        maxPeakRssBytes: 96 * 1024 * 1024,
        avgVia: 2.2,
      },
    ],
    [
      makeTest(1, 900, { drcErrorCount: 0 }),
      makeTest(2, 1_800, {
        relaxedDrcPassed: false,
        drcErrorCount: 1,
      }),
    ],
  )

  expect(
    renderBenchmarkComparison({ mainReport, prReport }).join("\n"),
  ).toContain(`Dataset: srj18 · Scenarios: 2 · Effort: 1x effort

| Solver | Metric | Main | PR | Change |
| --- | --- | ---: | ---: | ---: |
| Pipeline7 | Completion | 50.0% (🕒50.0%) | 100.0% | +50.0 pp |
| Pipeline7 | Relaxed DRC pass | 0.0% (🕒50.0%) | 50.0% | +50.0 pp |
| Pipeline7 | DRC issues | 3 | 1 | -2 |
| Pipeline7 | Timeouts | 1 | 0 | -1 |
| Pipeline7 | P50 time | 1.5s | 1.4s | -10.0% |
| Pipeline7 | P60 time | 1.6s | 1.4s | -10.0% |
| Pipeline7 | P70 time | 1.7s | 1.5s | -10.0% |
| Pipeline7 | P80 time | 1.8s | 1.6s | -10.0% |
| Pipeline7 | P90 time | 1.9s | 1.7s | -10.0% |
| Pipeline7 | P95 time | 1.9s | 1.8s | -10.0% |
| Pipeline7 | Average peak RSS | 100.0 MiB | 80.0 MiB | -20.0% |
| Pipeline7 | P50 peak RSS | 90.0 MiB | 72.0 MiB | -20.0% |
| Pipeline7 | P95 peak RSS | 110.0 MiB | 88.0 MiB | -20.0% |
| Pipeline7 | Max peak RSS | 120.0 MiB | 96.0 MiB | -20.0% |
| Pipeline7 | Average vias | 2.00 | 2.20 | +10.0% |
| Pipeline7 | Avg Angled Traces | n/a | n/a | n/a |

_DRC issues are totaled across solved samples. Timing percentiles include all samples, with failed and timed-out samples counted at their configured timeout; negative timing changes are faster. Historical failures without timeout metadata make timing percentiles unavailable._`)
  mainReport.tests[1] = {
    ...mainReport.tests[1],
    didTimeout: false,
    elapsedTimeMs: 10,
  }
  expect(
    renderBenchmarkComparison({ mainReport, prReport }).join("\n"),
  ).toContain("| Pipeline7 | P50 time | 1.5s | 1.4s | -10.0% |")
  delete mainReport.tests[1].sampleTimeoutMs
  expect(
    renderBenchmarkComparison({ mainReport, prReport }).join("\n"),
  ).toContain("| Pipeline7 | P50 time | n/a | 1.4s | n/a |")
})

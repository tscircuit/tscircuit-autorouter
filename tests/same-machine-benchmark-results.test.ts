import { expect, test } from "bun:test"
import type {
  BenchmarkReport,
  WorkerResult,
} from "../scripts/benchmark/benchmark-types"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"

test("same-machine benchmark comments compare matching reports", () => {
  const solverName = "AutoroutingPipelineSolver7_MultiGraph"
  const makeTest = (
    sampleNumber: number,
    overrides: Partial<WorkerResult>,
  ): WorkerResult => ({
    solverName,
    scenarioName: `sample${sampleNumber}`,
    sampleNumber,
    elapsedTimeMs: 1_000,
    sampleTimeoutMs: 2_000,
    didSolve: true,
    didTimeout: false,
    relaxedDrcPassed: true,
    ...overrides,
  })
  const makeReport = (
    overrides: Partial<BenchmarkReport>,
  ): BenchmarkReport => ({
    version: 1,
    datasetName: "srj18",
    scenarioCount: 2,
    effortLabel: "1x effort",
    summary: [],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: [],
    ...overrides,
  })
  const baseReport = makeReport({
    summary: [
      {
        solverName,
        completedRateLabel: "50.0% (🕒50.0%)",
        relaxedDrcRateLabel: "0.0% (🕒50.0%)",
        timedOutLabel: "1/2",
        p50TimeMs: 1_000,
        p95TimeMs: 2_000,
        p50PeakRssBytes: 90 * 1024 * 1024,
        p80PeakRssBytes: 110 * 1024 * 1024,
        p90PeakRssBytes: 120 * 1024 * 1024,
        avgVia: 2,
        avgTraceLintIssues: { odd_angle: 4, future_rule: 2 },
      },
    ],
    tests: [
      makeTest(1, {
        didSolve: false,
        didTimeout: true,
        relaxedDrcPassed: false,
        elapsedTimeMs: 2_000,
      }),
      makeTest(2, {
        relaxedDrcPassed: false,
        drcErrorCount: 3,
      }),
    ],
  })
  const prReport = makeReport({
    summary: [
      {
        solverName,
        completedRateLabel: "100.0% (🕒0.0%)",
        relaxedDrcRateLabel: "50.0% (🕒0.0%)",
        timedOutLabel: "0/2",
        p50TimeMs: 900,
        p95TimeMs: 1_800,
        p50PeakRssBytes: 72 * 1024 * 1024,
        p80PeakRssBytes: 88 * 1024 * 1024,
        p90PeakRssBytes: 96 * 1024 * 1024,
        avgVia: 2.2,
        avgTraceLintIssues: { odd_angle: 2, future_rule: 0 },
      },
    ],
    tests: [
      makeTest(1, { elapsedTimeMs: 1_800, drcErrorCount: 0 }),
      makeTest(2, {
        relaxedDrcPassed: false,
        drcErrorCount: 1,
      }),
    ],
  })

  const markdown = renderSameMachineBenchmarkResults({
    baseReport,
    prReport,
    baseSha: "a".repeat(40),
    prSha: "b".repeat(40),
    repository: "tscircuit/tscircuit-autorouter",
    runnerName: "blacksmith-test-runner",
  })

  expect(markdown).toStartWith("## Same Machine Benchmark Results\n")
  expect(markdown).toContain(
    "Both revisions ran sequentially in one Blacksmith job",
  )
  expect(markdown).toContain(
    "| Pipeline7 | Completion | 50.0% (🕒50.0%) | 100.0% (🕒0.0%) | +50.0 pp |",
  )
  expect(markdown).toContain(
    "| Pipeline7 | Avg Angled Traces | 4.00 | 2.00 | -50.0% |",
  )
  expect(markdown).toContain(
    "| Pipeline7 | Avg future_rule | 2.00 | 0.00 | -100.0% |",
  )
  expect(markdown).toContain("| Pipeline7 | DRC issues | 3 | 1 | -2 |")
  expect(markdown).toContain("| Pipeline7 | Timeouts | 1 | 0 | -1 |")
  expect(markdown).toContain("| Pipeline7 | P50 time | 1.5s | 1.4s | -6.7% |")
  expect(markdown).toContain("| Pipeline7 | P60 time |")
  expect(markdown).toContain("| Pipeline7 | P70 time |")
  expect(markdown).toContain("| Pipeline7 | P80 time |")
  expect(markdown).toContain("| Pipeline7 | P90 time |")
  expect(markdown).toContain("| Pipeline7 | P95 time |")
  expect(markdown).toContain(
    "| Pipeline7 | P50 peak RSS | 90.0 MiB | 72.0 MiB | -20.0% |",
  )
  expect(markdown).toContain("Outcome changes: **1 improved**, **0 regressed**")
  expect(markdown).toContain(
    "Timing percentiles include all samples, with failed and timed-out samples counted at their configured timeout",
  )
  expect(markdown).toContain("| Pipeline7 | 1 | Timeout | DRC passed |")
  baseReport.tests[0] = {
    ...baseReport.tests[0],
    didTimeout: false,
    elapsedTimeMs: 10,
  }
  const renderFailedBase = (): string =>
    renderSameMachineBenchmarkResults({
      baseReport,
      prReport,
      baseSha: "a".repeat(40),
      prSha: "b".repeat(40),
      repository: "tscircuit/tscircuit-autorouter",
      runnerName: "blacksmith-test-runner",
    })
  expect(renderFailedBase()).toContain(
    "| Pipeline7 | P50 time | 1.5s | 1.4s | -6.7% |",
  )
  expect(renderFailedBase()).toContain(
    "| Pipeline7 | 1 | Failed | DRC passed | 10ms |",
  )
  delete baseReport.summary[0].avgTraceLintIssues
  expect(renderFailedBase()).toContain(
    "| Pipeline7 | Avg Angled Traces | n/a | 2.00 | n/a |",
  )
  delete baseReport.tests[0].sampleTimeoutMs
  expect(renderFailedBase()).toContain(
    "| Pipeline7 | P50 time | n/a | 1.4s | n/a |",
  )
  expect(() =>
    renderSameMachineBenchmarkResults({
      baseReport,
      prReport: { ...prReport, datasetName: "srj19" },
      baseSha: "a".repeat(40),
      prSha: "b".repeat(40),
      repository: "tscircuit/tscircuit-autorouter",
      runnerName: "blacksmith-test-runner",
    }),
  ).toThrow("Dataset mismatch")
})

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
  const mainReport = makeReport({
    summary: [
      {
        solverName,
        completedRateLabel: "50.0%",
        relaxedDrcRateLabel: "50.0%",
        timedOutLabel: "1/2",
        p50TimeMs: 1_000,
        p95TimeMs: 2_000,
        avgVia: 2,
      },
    ],
    tests: [
      makeTest(1, {
        didSolve: false,
        didTimeout: true,
        relaxedDrcPassed: false,
        elapsedTimeMs: 2_000,
      }),
      makeTest(2, {}),
    ],
  })
  const prReport = makeReport({
    summary: [
      {
        solverName,
        completedRateLabel: "100.0%",
        relaxedDrcRateLabel: "100.0%",
        timedOutLabel: "0/2",
        p50TimeMs: 900,
        p95TimeMs: 1_800,
        avgVia: 2.2,
      },
    ],
    tests: [makeTest(1, { elapsedTimeMs: 1_800 }), makeTest(2, {})],
  })

  const markdown = renderSameMachineBenchmarkResults({
    mainReport,
    prReport,
    mainSha: "a".repeat(40),
    prSha: "b".repeat(40),
    repository: "tscircuit/tscircuit-autorouter",
    runnerName: "blacksmith-test-runner",
  })

  expect(markdown).toStartWith("## Same Machine Benchmark Results\n")
  expect(markdown).toContain(
    "Both revisions ran sequentially in one Blacksmith job",
  )
  expect(markdown).toContain(
    "| Pipeline7 | Completion | 50.0% | 100.0% | +50.0 pp |",
  )
  expect(markdown).toContain("| Pipeline7 | Timeouts | 1 | 0 | -1 |")
  expect(markdown).toContain("| Pipeline7 | P50 time | 1.0s | 900ms | -10.0% |")
  expect(markdown).toContain("Outcome changes: **1 improved**, **0 regressed**")
  expect(markdown).toContain("| Pipeline7 | 1 | Timeout | DRC passed |")
  expect(() =>
    renderSameMachineBenchmarkResults({
      mainReport,
      prReport: { ...prReport, datasetName: "srj19" },
      mainSha: "a".repeat(40),
      prSha: "b".repeat(40),
      repository: "tscircuit/tscircuit-autorouter",
      runnerName: "blacksmith-test-runner",
    }),
  ).toThrow("Dataset mismatch")
})

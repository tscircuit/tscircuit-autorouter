import { expect, test } from "bun:test"
import type {
  BenchmarkReport,
  SolverRunSummary,
  WorkerResult,
} from "../scripts/benchmark/benchmark-types"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"

test("same-machine benchmark compares different single default solvers", () => {
  const mainSolverName = "AutoroutingPipelineSolver9"
  const prSolverName = "AutoroutingPipelineSolver7_MultiGraph"
  const makeSummary = (
    solverName: string,
    completedRateLabel: string,
  ): SolverRunSummary => ({
    solverName,
    completedRateLabel,
    relaxedDrcRateLabel: completedRateLabel,
    timedOutLabel: completedRateLabel.startsWith("0.0%") ? "1/1" : "0/1",
    p50TimeMs: 1_000,
    p95TimeMs: 1_000,
    avgVia: completedRateLabel.startsWith("0.0%") ? null : 2,
  })
  const makeTest = (
    solverName: string,
    didSolve: boolean,
  ): WorkerResult => ({
    solverName,
    scenarioName: "sample1",
    sampleNumber: 1,
    elapsedTimeMs: didSolve ? 1_000 : 2_000,
    didSolve,
    didTimeout: !didSolve,
    relaxedDrcPassed: didSolve,
    drcErrorCount: didSolve ? 0 : undefined,
  })
  const makeReport = (
    summary: SolverRunSummary,
    workerResult: WorkerResult,
  ): BenchmarkReport => ({
    version: 1,
    datasetName: "srj18",
    scenarioCount: 1,
    effortLabel: "1x effort",
    summary: [summary],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: [workerResult],
  })
  const mainReport = makeReport(
    makeSummary(mainSolverName, "0.0% (🕒100.0%)"),
    makeTest(mainSolverName, false),
  )
  const prReport = makeReport(
    makeSummary(prSolverName, "100.0% (🕒0.0%)"),
    makeTest(prSolverName, true),
  )

  const markdown = renderSameMachineBenchmarkResults({
    mainReport,
    prReport,
    mainSha: "a".repeat(40),
    prSha: "b".repeat(40),
    repository: "tscircuit/tscircuit-autorouter",
    runnerName: "blacksmith-test-runner",
  })

  expect(markdown).toContain(
    "| Pipeline9 → Pipeline7 | Completion | 0.0% (🕒100.0%) | 100.0% (🕒0.0%) | +100.0 pp |",
  )
  expect(markdown).toContain(
    "| Pipeline9 → Pipeline7 | P50 time | 2.0s | 1.0s | -50.0% |",
  )
  expect(markdown).toContain("Outcome changes: **1 improved**, **0 regressed**")
  expect(markdown).toContain(
    "| Pipeline9 → Pipeline7 | 1 | Timeout | DRC passed |",
  )
})

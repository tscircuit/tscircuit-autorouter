import { expect, test } from "bun:test"
import type { BenchmarkReport } from "../scripts/benchmark/benchmark-types"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"

test("paired comparisons reject inconsistent checkers, refs, and case results", (): void => {
  const report: BenchmarkReport = {
    version: 1,
    solverRevision: "a".repeat(40),
    drcRevision: "c".repeat(40),
    datasetName: "srj18",
    scenarioCount: 1,
    effortLabel: "1x effort",
    summary: [],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: [
      {
        solverName: "Pipeline9",
        scenarioName: "sample1",
        sampleNumber: 1,
        elapsedTimeMs: 1,
        didSolve: true,
        didTimeout: false,
        relaxedDrcPassed: true,
        drcErrorCount: 0,
      },
    ],
  }
  const input = {
    mainReport: report,
    prReport: { ...report, solverRevision: "b".repeat(40) },
    mainSha: "a".repeat(40),
    prSha: "b".repeat(40),
    repository: "tscircuit/tscircuit-autorouter",
    runnerName: "test",
  }
  for (const drcRevision of [undefined, "d".repeat(40)]) {
    expect(() =>
      renderSameMachineBenchmarkResults({
        ...input,
        prReport: { ...input.prReport, drcRevision },
      }),
    ).toThrow("same DRC revision")
  }
  expect(() =>
    renderSameMachineBenchmarkResults({ ...input, prSha: "e".repeat(40) }),
  ).toThrow("solver revisions")
  expect(() =>
    renderSameMachineBenchmarkResults({
      ...input,
      prReport: { ...input.prReport, tests: [] },
    }),
  ).toThrow("identical unique cases")
  expect(() =>
    renderSameMachineBenchmarkResults({
      ...input,
      prReport: {
        ...input.prReport,
        tests: [{ ...report.tests[0]!, drcErrorCount: undefined }],
      },
    }),
  ).toThrow("Missing or invalid DRC count")
})

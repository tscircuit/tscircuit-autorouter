import { expect, test } from "bun:test"
import type { BenchmarkReport } from "../scripts/benchmark/benchmark-types"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"

test("same-machine reports separate detector changes from common-rule regressions", () => {
  const solverName = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  const mainReport: BenchmarkReport = {
    version: 1,
    datasetName: "srj18",
    scenarioCount: 2,
    effortLabel: "1x effort",
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    drcScoring: { kind: "common-core-rules", evaluatorSha: "a".repeat(40) },
    summary: [
      {
        solverName,
        completedRateLabel: "100.0%",
        relaxedDrcRateLabel: "0.0%",
        timedOutLabel: "0/2",
        p50TimeMs: 100,
        p95TimeMs: 100,
        avgVia: 0,
      },
    ],
    tests: [1, 2].map((sampleNumber) => ({
      solverName,
      scenarioName: `sample${sampleNumber}`,
      sampleNumber,
      didSolve: true,
      didTimeout: false,
      elapsedTimeMs: 100,
      relaxedDrcPassed: false,
      drcErrorCount: 1,
      commonDrcEvaluationTimeMs: 4,
      nativeDrc: { passed: true, errorCount: 0, evaluationTimeMs: 2 },
      routedGeometryHash: `geometry${sampleNumber}`,
    })),
  }
  const prReport: BenchmarkReport = {
    ...mainReport,
    tests: mainReport.tests.map((result) => ({
      ...result,
      nativeDrc: {
        passed: false,
        errorCount: result.sampleNumber,
        evaluationTimeMs: 3,
      },
      drcErrorCount: result.sampleNumber,
      routedGeometryHash:
        result.sampleNumber === 1 ? result.routedGeometryHash : "changed",
    })),
  }
  const input = {
    mainReport,
    prReport,
    mainSha: "b".repeat(40),
    prSha: "c".repeat(40),
    repository: "tscircuit/tscircuit-autorouter",
    runnerName: "test-runner",
  }
  const markdown = renderSameMachineBenchmarkResults(input)
  expect(markdown).toContain("Common-rule DRC pass")
  expect(markdown).toContain("| Pipeline9 | DRC issues | 2 | 3 | +1 |")
  expect(markdown).toContain("| Pipeline9 | Main | 2/2 | 0 | 2 | 2ms | 4ms |")
  expect(markdown).toContain(
    "| Pipeline9 | 1 | 0 → 1 | 1 → 1 | Unchanged | Detector-only reclassification; unchanged copper |",
  )
  expect(markdown).toContain(
    "| Pipeline9 | 2 | 0 → 2 | 1 → 2 | Changed | More DRCs under common rules |",
  )
  expect(markdown).toContain(
    "Common-rule DRC count changes: **0 improved**, **1 regressed**. Detector-only reclassifications: **1**",
  )
  expect(markdown).toContain("Outcome changes: **0 improved**, **0 regressed**")
  expect(() =>
    renderSameMachineBenchmarkResults({
      ...input,
      prReport: {
        ...prReport,
        drcScoring: { kind: "common-core-rules", evaluatorSha: "d".repeat(40) },
      },
    }),
  ).toThrow("same DRC evaluator")
})

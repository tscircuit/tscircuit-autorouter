import { expect, test } from "bun:test";
import type {
  BenchmarkReport,
  WorkerResult,
} from "../scripts/benchmark/benchmark-types";
import { renderBenchmarkComparison } from "../scripts/benchmark/benchmark-comment-comparison.js";

test("PR benchmark comments render one main-versus-PR comparison table", () => {
  const solverName = "AutoroutingPipelineSolver7_MultiGraph";
  const makeTest = (
    sampleNumber: number,
    elapsedTimeMs: number,
    overrides: Partial<WorkerResult> = {},
  ): WorkerResult => ({
    solverName,
    scenarioName: `sample${sampleNumber}`,
    sampleNumber,
    elapsedTimeMs,
    didSolve: true,
    didTimeout: false,
    relaxedDrcPassed: true,
    ...overrides,
  });
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
  });
  const mainReport = makeReport(
    [
      {
        solverName,
        completedRateLabel: "50.0% (🕒50.0%)",
        relaxedDrcRateLabel: "0.0% (🕒50.0%)",
        timedOutLabel: "1/2",
        p50TimeMs: 1_000,
        p95TimeMs: 1_000,
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
  );
  const prReport = makeReport(
    [
      {
        solverName,
        completedRateLabel: "100.0%",
        relaxedDrcRateLabel: "50.0%",
        timedOutLabel: "0/2",
        p50TimeMs: 1_350,
        p95TimeMs: 1_755,
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
  );

  expect(renderBenchmarkComparison({ mainReport, prReport }).join("\n"))
    .toBe(`Dataset: srj18 · Scenarios: 2 · Effort: 1x effort

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
| Pipeline7 | Average vias | 2.00 | 2.20 | +10.0% |

_DRC issues are totaled across solved samples. Timing percentiles include solved and timed-out samples; negative timing changes are faster._`);
});

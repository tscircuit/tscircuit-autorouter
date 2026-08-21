import { expect, test } from "bun:test";
import type { WorkerResult } from "../scripts/benchmark/benchmark-types";
import { summarizeSolverResults } from "../scripts/benchmark/index";

test("benchmark timing percentiles include solved and timed-out samples", () => {
  const solverName = "AutoroutingPipelineSolver7_MultiGraph";
  const makeResult = (
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
  const results = [
    makeResult(1, 100),
    makeResult(2, 200),
    makeResult(3, 300),
    makeResult(4, 400),
    makeResult(5, 1_000, {
      didSolve: false,
      didTimeout: true,
      relaxedDrcPassed: false,
    }),
    makeResult(6, 10, {
      didSolve: false,
      relaxedDrcPassed: false,
      error: "failed before routing",
    }),
  ];

  const summary = summarizeSolverResults(solverName, results);
  expect(summary.p50TimeMs).toBe(300);
  expect(summary.p60TimeMs).toBeCloseTo(340);
  expect(summary.p70TimeMs).toBeCloseTo(380);
  expect(summary.p80TimeMs).toBeCloseTo(520);
  expect(summary.p90TimeMs).toBeCloseTo(760);
  expect(summary.p95TimeMs).toBeCloseTo(880);
});

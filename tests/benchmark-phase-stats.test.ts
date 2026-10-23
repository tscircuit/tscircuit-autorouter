import { expect, test } from "bun:test"
import { getRoutingBenchmarkMetrics } from "../scripts/benchmark/benchmark-run-task"

test("benchmark phase counters and separate timing diagnostics exclude invalid values and retained solver state", () => {
  const solver = {
    currentPipelineStepIndex: 0,
    startTimeOfPhase: {},
    pipelineDef: [
      { solverName: "highDensityRouteSolver" },
      { solverName: "timingOnlySolver" },
      { solverName: "unstartedSolver" },
    ],
    timeSpentOnPhase: { highDensityRouteSolver: 12 },
    highDensityRouteSolver: {
      iterations: 3,
      stats: {
        constructed: 2,
        rejected: 0,
        invalid: NaN,
        unbounded: Infinity,
        retainedState: new Array(100).fill({ x: 1 }),
        message: "diagnostic",
      },
      benchmarkDiagnosticTimings: {
        monotoneFamilySceneSetupTimeMs: 0.25,
        invalidTiming: NaN,
        unboundedTiming: Infinity,
        retainedTimingState: { startedAt: 12 },
        timingMessage: "diagnostic",
      },
    },
    timingOnlySolver: { benchmarkDiagnosticTimings: { constructorSetupTimeMs: 0.5 } },
  }
  const metrics = getRoutingBenchmarkMetrics(solver)
  expect(metrics.phaseStats).toEqual({
    highDensityRouteSolver: { constructed: 2, rejected: 0, monotoneFamilySceneSetupTimeMs: 0.25 },
    timingOnlySolver: { constructorSetupTimeMs: 0.5 },
  })
  expect(Object.hasOwn(solver.highDensityRouteSolver.stats, "monotoneFamilySceneSetupTimeMs")).toBe(false)
  expect(metrics.highDensityIterations).toBe(3)
  expect(metrics.phaseTimeMs).toEqual(solver.timeSpentOnPhase)
  expect(JSON.parse(JSON.stringify(metrics)).phaseStats).toEqual(
    metrics.phaseStats,
  )
})

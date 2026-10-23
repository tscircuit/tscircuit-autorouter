import { expect, test } from "bun:test"
import { getRoutingBenchmarkMetrics } from "../scripts/benchmark/benchmark-run-task"

test("benchmark phase diagnostics preserve measured zero and omit unknown values without mutating solver stats", (): void => {
  const stats = Object.freeze({ accepted: 0, nested: { accepted: 2 }, unknown: undefined })
  const counters = Object.freeze({ materialized: 7, missing: Number.NaN, unbounded: Infinity })
  const solver = {
    currentPipelineStepIndex: 0,
    pipelineDef: [{ solverName: "highDensityRouteSolver" }, { solverName: "missingPhase" }],
    startTimeOfPhase: {},
    timeSpentOnPhase: { highDensityRouteSolver: 12 },
    highDensityRouteSolver: {
      iterations: 5,
      stats,
      benchmarkDiagnosticCounters: counters,
      benchmarkDiagnosticTimings: { setupMs: 3 },
    },
  }
  const result = getRoutingBenchmarkMetrics(solver)
  expect(result.phaseStats).toEqual({ highDensityRouteSolver: { accepted: 0, materialized: 7, setupMs: 3 } })
  expect(result.highDensityIterations).toBe(5)
  expect(result.phaseTimeMs).toBe(solver.timeSpentOnPhase)
  expect(solver.highDensityRouteSolver.stats).toBe(stats)
  expect(solver.highDensityRouteSolver.benchmarkDiagnosticCounters).toBe(counters)
  expect("materialized" in stats).toBeFalse()
  expect("missingPhase" in result.phaseStats!).toBeFalse()
})

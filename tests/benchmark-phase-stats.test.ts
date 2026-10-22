import { expect, test } from "bun:test"
import { getRoutingBenchmarkMetrics } from "../scripts/benchmark/benchmark-run-task"

test("benchmark phase counters exclude invalid values and retained solver state", () => {
  const solver = {
    currentPipelineStepIndex: 0,
    startTimeOfPhase: {},
    pipelineDef: [
      { solverName: "highDensityRouteSolver" },
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
    },
  }
  const metrics = getRoutingBenchmarkMetrics(solver)
  expect(metrics.phaseStats).toEqual({
    highDensityRouteSolver: { constructed: 2, rejected: 0 },
  })
  expect(metrics.highDensityIterations).toBe(3)
  expect(metrics.phaseTimeMs).toEqual(solver.timeSpentOnPhase)
  expect(JSON.parse(JSON.stringify(metrics)).phaseStats).toEqual(
    metrics.phaseStats,
  )
})

import { expect, test } from "bun:test"
import { getRoutingBenchmarkMetrics } from "../scripts/benchmark/benchmark-run-task"

test("benchmark records observed joint DRC worker and acceptance metrics", (): void => {
  const solver = {
    currentPipelineStepIndex: 0,
    pipelineDef: [],
    startTimeOfPhase: {},
    timeSpentOnPhase: {},
    pipeline9JointDrcRepairSolver: {
      stats: {
        initialDrcWorkerCount: 2,
        speculativeExactRepairDispatched: 1,
        speculativeExactRepairAccepted: false,
        initialBoundedRegionalRepairAccepted: true,
      },
    },
  }
  expect(getRoutingBenchmarkMetrics(solver).jointDrcRepair).toEqual(
    solver.pipeline9JointDrcRepairSolver.stats,
  )
  expect(
    getRoutingBenchmarkMetrics({
      ...solver,
      pipeline9JointDrcRepairSolver: { stats: {} },
    }).jointDrcRepair,
  ).toBeUndefined()
})

import { expect, test } from "bun:test"
import { getRoutingBenchmarkMetrics } from "../scripts/benchmark/benchmark-run-task"

test("benchmark records observed initial joint DRC repair metrics", (): void => {
  const solver = {
    currentPipelineStepIndex: 0,
    pipelineDef: [],
    startTimeOfPhase: {},
    timeSpentOnPhase: {},
    pipeline9JointDrcRepairSolver: {
      stats: {
        initialJointDrcIssueCount: 12,
        initialDrcWorkerCount: 2,
        initialDrcWorkerTimeMs: 3.5,
        initialBoundedRegionalRepairTimeMs: 42.5,
        initialBoundedRegionalRepairAttemptedRegionCount: 4,
        initialBoundedRegionalRepairAcceptedRegionCount: 2,
        initialBoundedRegionalRepairCandidateAttemptCount: 7,
        initialBoundedRegionalRepairPathSearchNodeCount: 23,
        initialBoundedRegionalRepairAccepted: false,
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

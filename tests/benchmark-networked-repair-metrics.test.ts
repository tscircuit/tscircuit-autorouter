import { expect, test } from "bun:test"
import { getRoutingBenchmarkMetrics } from "../scripts/benchmark/benchmark-run-task"

test("benchmark cache metrics include routing and repair while preserving ordinary metrics", (): void => {
  const solver = {
    currentPipelineStepIndex: 0, pipelineDef: [], startTimeOfPhase: {},
    timeSpentOnPhase: { highDensityRouteSolver: 10, highDensityRepairSolver: 20 },
    highDensityRouteSolver: {
      iterations: 12,
      stats: {
        remoteRequestsStarted: 2, remoteRequestsCompleted: 2,
        remoteBatchCacheMisses: 2, remoteSingleRequestsStarted: 2,
        remoteCacheHits: 0, remoteSolverResults: 2, remoteTransportFallbacks: 1,
        remoteFallbackReasonCounts: { invalid_response: 1 },
      },
    },
    highDensityRepairSolver: {
      stats: {
        remoteRequestsStarted: 3, remoteRequestsCompleted: 3,
        remoteBatchCacheMisses: 1, remoteSingleRequestsStarted: 1,
        remoteCacheHits: 2, remoteSolverResults: 1, remoteTransportFallbacks: 2,
        remoteFallbackReasonCounts: { invalid_response: 1, logical_timeout: 1 },
      },
    },
  }
  const metrics = getRoutingBenchmarkMetrics(solver)
  expect(metrics.highDensityIterations).toBe(12)
  expect(metrics.phaseTimeMs).toBe(solver.timeSpentOnPhase)
  expect(metrics.networkedHighDensity).toEqual({
    remoteRequestsStarted: 5, remoteRequestsCompleted: 5,
    remoteBatchCacheMisses: 3, remoteSingleRequestsStarted: 3,
    remoteCacheHits: 2, remoteSolverResults: 3, remoteTransportFallbacks: 3,
    remoteFallbackReasonCounts: { invalid_response: 2, logical_timeout: 1 },
  })
  expect(getRoutingBenchmarkMetrics({
    ...solver, highDensityRepairSolver: { stats: { viaCount: 3 } },
  }).networkedHighDensity).toEqual(solver.highDensityRouteSolver.stats)
  expect(getRoutingBenchmarkMetrics({
    ...solver,
    highDensityRouteSolver: { iterations: 12, stats: {} },
    highDensityRepairSolver: { stats: {} },
  }).networkedHighDensity).toBeUndefined()
})

import { expect, test } from "bun:test"
import {
  getRoutingBenchmarkMetrics,
  validateNetworkedBenchmark,
} from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"

test("hot benchmark validation drains repair requests and rejects a repair cache miss", async (): Promise<void> => {
  const task: BenchmarkTask = {
    datasetName: "test",
    solverName: "Pipeline9_Networked Hot",
    scenarioName: "test",
    sampleNumber: 1,
    networkedCachePass: "hot",
    scenario: {
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
    },
  }
  const waits: string[] = []
  const routeStats = {
    remoteRequestsStarted: 1,
    remoteRequestsCompleted: 0,
    remoteCacheHits: 1,
    remoteTransportFallbacks: 0,
    remoteFallbackReasonCounts: {} as Record<string, number>,
  }
  const repairStats = {
    remoteRequestsStarted: 1,
    remoteRequestsCompleted: 0,
    remoteCacheHits: 0,
    remoteBatchCacheMisses: 0,
    remoteSingleRequestsStarted: 0,
    remoteSolverResults: 0,
    remoteTransportFallbacks: 0,
    remoteFallbackReasonCounts: {} as Record<string, number>,
  }
  const solver = {
    currentPipelineStepIndex: 0,
    pipelineDef: [],
    startTimeOfPhase: {},
    timeSpentOnPhase: {},
    highDensityRouteSolver: {
      iterations: 12,
      stats: routeStats,
      async waitForAllRemoteRequests(): Promise<void> {
        waits.push("route")
        routeStats.remoteRequestsCompleted = 1
      },
    },
    highDensityRepairSolver: {
      stats: repairStats,
      async waitForAllRemoteRequests(): Promise<void> {
        waits.push("repair")
        await Promise.resolve()
        repairStats.remoteRequestsCompleted = 1
        repairStats.remoteBatchCacheMisses = 1
        repairStats.remoteSingleRequestsStarted = 1
        repairStats.remoteSolverResults = 1
      },
    },
  }

  await expect(validateNetworkedBenchmark(task, solver)).rejects.toThrow(
    "hot pass was not fully cached (1/2 cache hit(s), 1 batch miss(es), 1 single solve(s), 1 solver result(s))",
  )
  expect(waits).toEqual(["route", "repair"])
  expect(getRoutingBenchmarkMetrics(solver)).toMatchObject({
    highDensityIterations: 12,
    networkedHighDensity: {
      remoteRequestsStarted: 2,
      remoteRequestsCompleted: 2,
      remoteCacheHits: 1,
      remoteBatchCacheMisses: 1,
      remoteSingleRequestsStarted: 1,
      remoteSolverResults: 1,
      remoteTransportFallbacks: 0,
    },
  })
  await expect(validateNetworkedBenchmark(task, {
    ...solver,
    highDensityRepairSolver: undefined,
  })).resolves.toBeUndefined()

  routeStats.remoteTransportFallbacks = 1
  routeStats.remoteFallbackReasonCounts = { invalid_response: 1 }
  repairStats.remoteTransportFallbacks = 2
  repairStats.remoteFallbackReasonCounts = { invalid_response: 1, logical_timeout: 1 }
  expect(getRoutingBenchmarkMetrics(solver).networkedHighDensity).toMatchObject({
    remoteTransportFallbacks: 3,
    remoteFallbackReasonCounts: { invalid_response: 2, logical_timeout: 1 },
  })

  const waitsBeforeOrdinaryTask = waits.length
  await validateNetworkedBenchmark({ ...task, networkedCachePass: undefined }, solver)
  expect(waits).toHaveLength(waitsBeforeOrdinaryTask)
  const ordinaryMetrics = getRoutingBenchmarkMetrics({
    ...solver,
    highDensityRouteSolver: { iterations: 12, stats: {} },
    highDensityRepairSolver: { stats: {} },
  })
  expect(ordinaryMetrics.networkedHighDensity).toBeUndefined()
  expect(ordinaryMetrics.highDensityIterations).toBe(12)
})

import { expect, test } from "bun:test"
import {
  getRoutingBenchmarkMetrics,
  validateNetworkedBenchmark,
} from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"

test("benchmark validation awaits both stages and rejects repair fallbacks, misses and unfinished requests", async (): Promise<void> => {
  const task: BenchmarkTask = {
    datasetName: "srj18",
    solverName: "Pipeline9_Networked Hot",
    networkedCachePass: "hot",
    scenarioName: "fixture",
    sampleNumber: 1,
    scenario: {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    },
  }
  const routeStats = {
    remoteRequestsStarted: 1,
    remoteRequestsCompleted: 0,
    remoteCacheHits: 1,
    remoteBatchCacheMisses: 0,
    remoteSingleRequestsStarted: 0,
    remoteSolverResults: 0,
    remoteTransportFallbacks: 0,
  }
  const repairStats = {
    ...routeStats,
    remoteRequestsStarted: 2,
    remoteCacheHits: 2,
  }
  const waits: string[] = []
  let releaseRepair!: () => void
  const repairGate = new Promise<void>((resolve): void => {
    releaseRepair = resolve
  })
  const solver = {
    currentPipelineStepIndex: 0,
    pipelineDef: [],
    startTimeOfPhase: {},
    timeSpentOnPhase: {},
    highDensityRouteSolver: {
      stats: routeStats,
      async waitForAllRemoteRequests(): Promise<void> {
        waits.push("route")
        await Promise.resolve()
        routeStats.remoteRequestsCompleted = 1
      },
    },
    highDensityRepairSolver: {
      stats: repairStats,
      async waitForAllRemoteRequests(): Promise<void> {
        waits.push("repair")
        await repairGate
        repairStats.remoteRequestsCompleted = 2
      },
    },
  }
  let settled = false
  const validation = validateNetworkedBenchmark(task, solver).then((): void => {
    settled = true
  })
  await Promise.resolve()
  expect(waits).toEqual(["route", "repair"])
  expect(settled).toBe(false)
  releaseRepair()
  await validation
  expect(getRoutingBenchmarkMetrics(solver).networkedHighDensity).toMatchObject(
    {
      remoteRequestsStarted: 3,
      remoteRequestsCompleted: 3,
      remoteCacheHits: 3,
    },
  )

  repairStats.remoteTransportFallbacks = 1
  await expect(validateNetworkedBenchmark(task, solver)).rejects.toThrow(
    "used 1 local transport fallback(s)",
  )
  repairStats.remoteTransportFallbacks = 0
  repairStats.remoteCacheHits = 1
  repairStats.remoteBatchCacheMisses = 1
  repairStats.remoteSingleRequestsStarted = 1
  repairStats.remoteSolverResults = 1
  await expect(validateNetworkedBenchmark(task, solver)).rejects.toThrow(
    "hot pass was not fully cached (2/3 cache hit(s), 1 batch miss(es), 1 single solve(s), 1 solver result(s))",
  )
  await expect(
    validateNetworkedBenchmark({ ...task, networkedCachePass: "cold" }, solver),
  ).resolves.toBeUndefined()

  repairStats.remoteRequestsCompleted = 1
  await expect(
    validateNetworkedBenchmark(
      { ...task, networkedCachePass: "cold" },
      {
        ...solver,
        highDensityRepairSolver: {
          stats: repairStats,
          async waitForAllRemoteRequests(): Promise<void> {},
        },
      },
    ),
  ).rejects.toThrow("did not drain all requests (2/3)")
  await expect(
    validateNetworkedBenchmark(task, {
      ...solver,
      highDensityRepairSolver: { stats: repairStats },
    }),
  ).rejects.toThrow(
    "requires an explicit remote-request drain for highDensityRepairSolver",
  )
  await expect(
    validateNetworkedBenchmark(task, {
      ...solver,
      highDensityRouteSolver: { stats: routeStats },
    }),
  ).rejects.toThrow(
    "requires an explicit remote-request drain for highDensityRouteSolver",
  )
  expect(repairStats.remoteRequestsCompleted).toBe(2)

  let releaseFailedDrain!: () => void
  const failedDrainGate = new Promise<void>((resolve): void => {
    releaseFailedDrain = resolve
  })
  let repairDrained = false
  let failedDrainSettled = false
  const failedDrain = validateNetworkedBenchmark(task, {
    ...solver,
    highDensityRouteSolver: {
      stats: routeStats,
      async waitForAllRemoteRequests(): Promise<void> {
        throw new Error("route drain failed")
      },
    },
    highDensityRepairSolver: {
      stats: repairStats,
      async waitForAllRemoteRequests(): Promise<void> {
        await failedDrainGate
        repairDrained = true
      },
    },
  }).then(
    () => null,
    (error: unknown) => {
      failedDrainSettled = true
      return error
    },
  )
  await Promise.resolve()
  expect(failedDrainSettled).toBe(false)
  releaseFailedDrain()
  expect(String(await failedDrain)).toContain("route drain failed")
  expect(repairDrained).toBe(true)

  const waitsBeforeOrdinary = waits.length
  await validateNetworkedBenchmark(
    { ...task, networkedCachePass: undefined },
    solver,
  )
  expect(waits).toHaveLength(waitsBeforeOrdinary)
  await expect(
    validateNetworkedBenchmark(task, {
      ...solver,
      highDensityRepairSolver: { stats: {} },
    }),
  ).resolves.toBeUndefined()
})

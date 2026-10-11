import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import type { Pipeline9NetworkedHighDensityNodeInput } from "../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { solvePipeline9NetworkedHighDensityNode } from "../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import { getGlobalInMemoryCache } from "../lib/cache/setupGlobalCaches"
import { validateNetworkedBenchmark } from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"
import { createLocalHighDensityServer } from "../scripts/benchmark/createLocalHighDensityServer"
import {
  normalizeLocalHighDensityJson,
  type LocalHighDensityObject,
} from "../scripts/benchmark/localHighDensityProtocol"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "./fixtures/pipeline9-networked-fixtures"

type BenchmarkSolver = Parameters<typeof validateNetworkedBenchmark>[1]

test("local benchmarks retain real validation retries in both passes while rejecting remote and network failures", async () => {
  const faults: Error[] = []
  const handler = createLocalHighDensityServer({
    autorouterVersion: AUTOROUTER_VERSION,
    solve: (value: LocalHighDensityObject): LocalHighDensityObject => {
      getGlobalInMemoryCache().clearCache()
      const input = value as unknown as Pipeline9NetworkedHighDensityNodeInput
      const output = solvePipeline9NetworkedHighDensityNode(input)
      if (output.status !== "solved" || output.routes.length === 0) {
        throw new Error("The real helper must solve this validation fixture")
      }
      // Captured legacy helper outputs contain a one-point route inside an
      // otherwise valid terminal result. Keep the client's rejection intact.
      return normalizeLocalHighDensityJson({
        ...output,
        routes: output.routes.map((route, index) =>
          index === 0 ? { ...route, route: route.route.slice(0, 1) } : route,
        ),
      }) as LocalHighDensityObject
    },
    onFault: (error: Error): void => {
      faults.push(error)
    },
  })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler.fetch,
  })
  const url = `http://127.0.0.1:${server.port}`
  const cacheVersion = "legacy-validation-retry"
  const task: BenchmarkTask = {
    datasetName: "srj18",
    solverName: "Pipeline9_Networked Cold",
    networkedCachePass: "cold",
    networkedServer: { url, cacheVersion, backend: "local" },
    scenarioName: "validation-retry",
    sampleNumber: 1,
    scenario: {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    },
  }
  const cold = createNetworkedHighDensitySolver({
    nodes: [
      createNetworkedNode({
        nodeId: "retry-node",
        connectionName: "retry-trace",
      }),
    ],
    hdCache2ServerUrl: url,
    hdCache2CacheVersion: cacheVersion,
  })
  const coldPipeline: BenchmarkSolver = {
    currentPipelineStepIndex: 0,
    pipelineDef: [],
    startTimeOfPhase: {},
    timeSpentOnPhase: {},
    highDensityRouteSolver: cold,
  }

  try {
    await solveNetworkedHighDensitySolver(cold)
    expect(cold.solved).toBe(true)
    expect(cold.routes).toHaveLength(1)
    expect(cold.routes[0]!.route.length).toBeGreaterThan(1)
    await expect(
      validateNetworkedBenchmark(task, coldPipeline),
    ).resolves.toBeUndefined()
    expect(cold.stats).toMatchObject({
      remoteRequestsStarted: 1,
      remoteRequestsCompleted: 1,
      remoteBatchCacheMisses: 1,
      remoteSingleRequestsStarted: 1,
      remoteSolverResults: 0,
      remoteTransportFallbacks: 1,
      remoteFallbackReasonCounts: { invalid_response: 1 },
    })
    expect(handler.stats.jobsComputed).toBe(1)
    const computedCold = handler.stats.jobsComputed
    await expect(
      validateNetworkedBenchmark(
        {
          ...task,
          networkedServer: { ...task.networkedServer!, backend: "remote" },
        },
        coldPipeline,
      ),
    ).rejects.toThrow("used 1 local transport fallback(s)")

    getGlobalInMemoryCache().clearCache()
    const hot = createNetworkedHighDensitySolver({
      nodes: [
        createNetworkedNode({
          nodeId: "retry-node",
          connectionName: "retry-trace",
        }),
      ],
      hdCache2ServerUrl: url,
      hdCache2CacheVersion: cacheVersion,
    })
    const hotPipeline: BenchmarkSolver = {
      ...coldPipeline,
      highDensityRouteSolver: hot,
    }
    const hotTask: BenchmarkTask = {
      ...task,
      solverName: "Pipeline9_Networked Hot",
      networkedCachePass: "hot",
    }
    await solveNetworkedHighDensitySolver(hot)
    expect(hot.solved).toBe(true)
    expect(hot.routes).toEqual(cold.routes)
    await expect(
      validateNetworkedBenchmark(hotTask, hotPipeline),
    ).resolves.toBeUndefined()
    expect(hot.stats).toMatchObject({
      remoteRequestsStarted: 1,
      remoteRequestsCompleted: 1,
      remoteBatchCacheMisses: 0,
      remoteSingleRequestsStarted: 0,
      remoteCacheHits: 0,
      remoteSolverResults: 0,
      remoteTransportFallbacks: 1,
      remoteFallbackReasonCounts: { invalid_response: 1 },
    })
    expect(handler.stats.jobsComputed).toBe(computedCold)
    expect(handler.stats.cacheHits).toBe(1)
    await expect(
      validateNetworkedBenchmark(
        {
          ...hotTask,
          networkedServer: { ...task.networkedServer!, backend: "remote" },
        },
        hotPipeline,
      ),
    ).rejects.toThrow("used 1 local transport fallback(s)")

    await server.stop(true)
    getGlobalInMemoryCache().clearCache()
    const disconnected = createNetworkedHighDensitySolver({
      nodes: [
        createNetworkedNode({
          nodeId: "retry-node",
          connectionName: "retry-trace",
        }),
      ],
      hdCache2ServerUrl: url,
      hdCache2CacheVersion: cacheVersion,
    })
    await solveNetworkedHighDensitySolver(disconnected)
    expect(disconnected.solved).toBe(true)
    const disconnectedPipeline: BenchmarkSolver = {
      ...coldPipeline,
      highDensityRouteSolver: disconnected,
    }
    await expect(
      validateNetworkedBenchmark(task, disconnectedPipeline),
    ).rejects.toThrow("used 1 local transport fallback(s)")
    expect(disconnected.stats.remoteRequestsStarted).toBe(1)
    expect(disconnected.stats.remoteRequestsCompleted).toBe(1)
    expect(disconnected.stats.remoteTransportFallbacks).toBe(1)
    expect(disconnected.stats.remoteFallbackReasonCounts).not.toEqual({
      invalid_response: 1,
    })
    expect(faults).toEqual([])
  } finally {
    await server.stop(true)
    getGlobalInMemoryCache().clearCache()
  }
})

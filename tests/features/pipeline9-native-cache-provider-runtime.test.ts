import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9HighDensityBatchSolver, type Pipeline9HighDensityBatchInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("native cache policies survive worker JSON while caller-owned providers stay on the host", async (): Promise<void> => {
  const params: Pipeline9HighDensitySolverParams = { nodePortPoints: [
    { capacityMeshNodeId: "cache-runtime", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
      { connectionName: "signal", x: -2, y: 0, z: 0 }, { connectionName: "signal", x: 2, y: 0, z: 0 },
    ] },
  ], fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.1 }
  const globalCache = getGlobalInMemoryCache()
  globalCache.clearCache()
  const read = spyOn(globalCache, "getCachedSolutionSync")
  const write = spyOn(globalCache, "setCachedSolutionSync")
  const runtime = createPipeline9TestRuntime(1)
  const dispatch = spyOn(runtime, "executeAsync")
  try {
    const disabled = new Pipeline9HighDensitySolver({ ...params, cacheProvider: null })
    await disabled.solveAsync(runtime)
    expect(disabled.solved).toBe(true)
    expect(dispatch.mock.calls.length).toBeGreaterThan(0)
    for (const [, input] of dispatch.mock.calls) {
      expect(input.cacheProvider).toBeNull()
      const decoded: Pipeline9HighDensityBatchInput = JSON.parse(JSON.stringify(input))
      expect(decoded.cacheProvider).toBeNull()
      const serial = new Pipeline9HighDensityBatchSolver(decoded)
      serial.solve()
      expect(serial.getOutput().routes).toEqual(disabled.routes)
    }
    expect(read.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))).toHaveLength(0)
    expect(write.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))).toHaveLength(0)
    dispatch.mockClear()

    const omitted = new Pipeline9HighDensitySolver(params)
    await omitted.solveAsync(runtime)
    expect(omitted.solved).toBe(true)
    expect(dispatch.mock.calls.length).toBeGreaterThan(0)
    for (const [, input] of dispatch.mock.calls) expect(input.cacheProvider).toBeUndefined()
    dispatch.mockClear()
    read.mockClear()
    write.mockClear()

    const custom = new InMemoryCache()
    const host = new Pipeline9HighDensitySolver({ ...params, cacheProvider: custom })
    await host.solveAsync(runtime)
    expect(host.solved).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    expect(custom.getAllCacheKeys().some((key) => key.startsWith("intranode-solver:"))).toBe(true)
    expect(read.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))).toHaveLength(0)
    expect(write.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))).toHaveLength(0)
    expect(host.routes).toEqual(disabled.routes)
  } finally {
    dispatch.mockRestore()
    read.mockRestore()
    write.mockRestore()
    globalCache.clearCache()
    await runtime.dispose()
  }
})

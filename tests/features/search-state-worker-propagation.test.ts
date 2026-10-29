import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { searchStateFactoryNode } from "../solvers/searchStateTestUtils"

test("a required worker transports the opt-in and returns actual low-level activation", async (): Promise<void> => {
  const params = {
    nodePortPoints: [searchStateFactoryNode()], fixedHdRoutes: [],
    connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
    viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1,
    obstacleMargin: 0.1, effort: 1, experimentSearchState: true,
  }
  getGlobalInMemoryCache().clearCache()
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  const parallel = new Pipeline9HighDensitySolver(params)
  const runtime = createPipeline9TestRuntime(1)
  try {
    await parallel.solveAsync(runtime)
    expect(parallel.solved).toBe(true)
    expect(parallel.routes).toEqual(serial.routes)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.benchmarkDiagnosticCounters.searchStateLowLevelInstances).toBeGreaterThan(0)
    expect(parallel.benchmarkDiagnosticCounters.searchStateLowLevelInstances).toBe(serial.benchmarkDiagnosticCounters.searchStateLowLevelInstances)
    expect(parallel.benchmarkDiagnosticCounters.priorityWorkerBatchesCompleted).toBe(1)
  } finally {
    await runtime.dispose()
  }
})

import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createNetworkedCrossingNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("workers preserve regional success, regional failure and disabled-regional errors and statistics", async () => {
  const pool = new Pipeline9LocalWorkerPool()
  try {
    for (const config of [
      { layerCount: 2, enableRegionalFallback: true, solved: true },
      { layerCount: 1, enableRegionalFallback: true, solved: false },
      { layerCount: 2, enableRegionalFallback: false, solved: false },
    ]) {
      const params: Pipeline9HighDensitySolverParams = {
        nodePortPoints: [createNetworkedCrossingNode({ nodeId: "regional_policy" })],
        fixedHdRoutes: [], connMap: new ConnectivityMap({ horizontal: ["horizontal"], vertical: ["vertical"] }),
        obstacles: [], layerCount: config.layerCount, enableRegionalFallback: config.enableRegionalFallback,
        viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
        includeBoardObstacles: true, allowBlindAndBuriedVias: false, viaToPadClearance: 0.17,
      }
      getGlobalInMemoryCache().clearCache()
      const serial = new Pipeline9HighDensitySolver(params)
      serial.solve()
      const parallel = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool })
      while (!parallel.solved && !parallel.failed) {
        parallel.step()
        if (parallel.pendingEffects?.length) await Promise.all(parallel.pendingEffects.map((effect) => effect.promise))
      }
      expect(serial.solved).toBe(config.solved)
      expect(parallel.solved).toBe(serial.solved)
      expect(parallel.failed).toBe(serial.failed)
      expect(parallel.error).toBe(serial.error)
      expect(parallel.routes).toEqual(serial.routes)
      for (const [key, value] of Object.entries(serial.stats)) expect(parallel.stats[key]).toEqual(value)
    }
  } finally { pool.dispose() }
})

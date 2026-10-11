import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("four local workers preserve serial node order, root names and terminal IDs across repeated boards", async () => {
  const nodes = Array.from({ length: 8 }, (_, index) => createNetworkedNode({
    nodeId: `node_${index}`, connectionName: `connection_${index}`, xOffset: index * 6,
  }))
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: nodes, fixedHdRoutes: [],
    connMap: new ConnectivityMap(Object.fromEntries(nodes.map((node, index) => [
      `root_connection_${index}`, [`root_connection_${index}`, `connection_${index}`],
    ]))),
    obstacles: [], layerCount: 2, viaDiameter: 0.3, traceWidth: 0.15,
    obstacleMargin: 0.15, effort: 0.5, preserveTerminalPcbPortIds: true,
  }
  getGlobalInMemoryCache().clearCache()
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  expect(serial.solved).toBe(true)
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    for (let repetition = 0; repetition < 2; repetition++) {
      const parallel = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool })
      while (!parallel.solved && !parallel.failed) {
        parallel.step()
        if (parallel.pendingEffects?.length) await Promise.all(parallel.pendingEffects.map((effect) => effect.promise))
      }
      expect(parallel.solved).toBe(true)
      expect(parallel.routes).toEqual(serial.routes)
      expect(parallel.stats.parallelNodeCount).toBe(nodes.length)
      expect(parallel.stats.solvedNodeCount).toBe(serial.stats.solvedNodeCount)
      expect(parallel.stats.parallelBatchedNodeCount).toBe(8)
      expect(parallel.stats.parallelNodeBatchCount).toBe(4)
    }
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(pool.stats.tasksCompleted).toBe(8)
  } finally { pool.dispose() }
})

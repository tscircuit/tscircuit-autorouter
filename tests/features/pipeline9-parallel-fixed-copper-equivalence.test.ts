import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createNetworkedFixedRoute, createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("preloaded copper remains serial and retains exact B01 routing and mutations", async () => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: [createNetworkedNode({ nodeId: "fixed_node", connectionName: "route" })],
    fixedHdRoutes: [createNetworkedFixedRoute()],
    connMap: new ConnectivityMap({ root_route: ["root_route", "route"], root_fixed_foreign: ["root_fixed_foreign", "fixed_foreign"] }),
    obstacles: [], layerCount: 2, viaDiameter: 0.3, traceWidth: 0.15,
    obstacleMargin: 0.15, effort: 1, preserveTerminalPcbPortIds: true,
  }
  const serial = new Pipeline9HighDensitySolver({ ...params,
    nodePortPoints: structuredClone(params.nodePortPoints), fixedHdRoutes: structuredClone(params.fixedHdRoutes) })
  serial.solve()
  const pool = new Pipeline9LocalWorkerPool()
  try {
    const parallel = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool,
      nodePortPoints: structuredClone(params.nodePortPoints), fixedHdRoutes: structuredClone(params.fixedHdRoutes) })
    while (!parallel.solved && !parallel.failed) parallel.step()
    expect(parallel.solved).toBe(serial.solved)
    expect(parallel.error).toBe(serial.error)
    expect(parallel.routes).toEqual(serial.routes)
    expect(parallel.getUpdatedFixedHdRoutes()).toEqual(serial.getUpdatedFixedHdRoutes())
    expect(parallel.preloadedTraceMutationMasks).toEqual(serial.preloadedTraceMutationMasks)
    expect(pool.stats.tasksStarted).toBe(0)
  } finally { pool.dispose() }
})

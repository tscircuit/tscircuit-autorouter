import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { ParallelHighDensityNodeBatchJob, ParallelHighDensityNodeBatchResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityNodeBatching"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("an actual worker preserves a batch node algorithm exception as data and completes the other native children", async (): Promise<void> => {
  const job: ParallelHighDensityNodeBatchJob = { kind: "highDensityNodeBatch", contextId: 1,
    context: { connectivityNetMap: {}, connectivityIdToNetMap: {}, colorMap: {}, obstacles: [],
      viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1, layerCount: 2,
      allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: true,
      includeBoardObstacles: false, enableRegionalFallback: false, highDensityPolicy: "ordered" },
    nodes: ["batch-before", "batch-algorithm-exception", "batch-after"].map((nodeId, index) => ({
      nodeWithPortPoints: createNetworkedNode({ nodeId, connectionName: `signal_${index}`, xOffset: index * 6 }), nodePf: null,
    })) }
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4,
    workerUrl: new URL("../fixtures/high-density-batch-exception-worker.ts", import.meta.url) })
  try {
    const result = await pool.run<ParallelHighDensityNodeBatchResult>(job)
    expect(result.results.map((entry) => entry.nodeId)).toEqual(job.nodes.map((entry) => entry.nodeWithPortPoints.capacityMeshNodeId))
    expect(result.results.map((entry) => entry.result.status)).toEqual(["solved", "exception", "solved"])
    const exception = result.results[1]!.result
    expect(exception).toMatchObject({ status: "exception", exception: {
      name: "RangeError", message: "controlled native batch node failure" }, nodeIterations: 0,
      nodeMaximumIterations: 100e6, nodeStats: { nodeCount: 1, solvedNodeCount: 0 } })
    for (const index of [0, 2]) {
      const entry = job.nodes[index]!
      const native = new Pipeline9HighDensitySolver({ ...job.context, connMap: new ConnectivityMap({}),
        nodePortPoints: [entry.nodeWithPortPoints], fixedHdRoutes: [] })
      native.solve()
      expect(result.results[index]!.result).toEqual({ status: "solved", routes: native.routes,
        nodeStats: native.stats, nodeIterations: native.iterations, nodeMaximumIterations: native.MAX_ITERATIONS })
    }
    await pool.warmup()
    expect(pool.stats.tasksCompleted).toBe(5)
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(pool.stats.historyRequestsGranted).toBe(0)
    expect(pool.stats.a13RequestsGranted).toBe(0)
  } finally { pool.dispose() }
})

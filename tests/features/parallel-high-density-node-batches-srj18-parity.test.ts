import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import type { ParallelHighDensityNodeBatchResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityNodeBatching"
import type { Pipeline9LocalWorkerJob, Pipeline9ParallelHighDensityNodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

class RecordingHighDensityPool extends Pipeline9LocalWorkerPool {
  readonly nodeResults = new Map<string, Pipeline9ParallelHighDensityNodeResult>()
  override async run<T>(job: Pipeline9LocalWorkerJob): Promise<T> {
    const result = await super.run<T>(job)
    if (job.kind === "highDensityNode") {
      this.nodeResults.set(job.nodeWithPortPoints.capacityMeshNodeId, result as Pipeline9ParallelHighDensityNodeResult)
    } else if (job.kind === "highDensityNodeBatch") {
      for (const entry of (result as ParallelHighDensityNodeBatchResult).results) this.nodeResults.set(entry.nodeId, entry.result)
    }
    return result
  }
}

test("four actual workers batch SRJ18 001 tiny HD nodes with exact native geometry, counters and node caps", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1, 1)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, { effort: 1, cacheProvider: null })
  while (pipeline.getCurrentPhase() !== "highDensityRouteSolver" && !pipeline.solved && !pipeline.failed) pipeline.step()
  expect(pipeline.failed).toBe(false)
  const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "highDensityRouteSolver")
  if (!stage) throw new Error("HD batch parity fixture is missing the native HD stage")
  const [input] = stage.getConstructorParams(pipeline)
  const params = input as Pipeline9HighDensitySolverParams
  expect(params.fixedHdRoutes).toHaveLength(0)
  getGlobalInMemoryCache().clearCache()
  const native = new Pipeline9HighDensitySolver(params)
  native.solve()
  expect(native.solved).toBe(true)
  const pool = new RecordingHighDensityPool({ workerCount: 4 })
  try {
    const parallel = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool })
    while (!parallel.solved && !parallel.failed) {
      parallel.step()
      if (parallel.pendingEffects?.length) await Promise.all(parallel.pendingEffects.map((effect) => effect.promise))
    }
    expect(parallel.solved).toBe(true)
    expect(parallel.failed).toBe(false)
    // Native grow/shrink routes retain an internal originalPortPoint symbol;
    // the existing worker boundary intentionally transports enumerable data.
    expect(parallel.routes).toEqual(structuredClone(native.routes))
    expect(parallel.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
    for (const [key, value] of Object.entries(native.stats)) expect(parallel.stats[key]).toEqual(value)
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(pool.stats.tasksStarted).toBe(pool.stats.tasksCompleted)
    expect(pool.stats.historyRequestsGranted).toBe(0)
    expect(pool.stats.historyRequestsDenied).toBe(0)
    expect(pool.stats.a13RequestsGranted).toBe(0)
    expect(pool.stats.a13RequestsDenied).toBe(0)
    expect(parallel.stats.parallelBatchedNodeCount).toBeGreaterThan(200)
    expect(parallel.stats.parallelNodeBatchCount).toBeGreaterThan(4)
    expect(pool.stats.tasksCompleted).toBeLessThan(params.nodePortPoints.length - 200)
    expect(parallel.stats.parallelNodesCompleted).toBe(params.nodePortPoints.length)
    expect(pool.nodeResults.size).toBe(params.nodePortPoints.length)
    for (const node of params.nodePortPoints) {
      getGlobalInMemoryCache().clearCache()
      const serialNode = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [node] })
      serialNode.solve()
      expect(serialNode.solved).toBe(true)
      const result = pool.nodeResults.get(node.capacityMeshNodeId)
      expect(result).toEqual({ status: "solved", routes: structuredClone(serialNode.routes), nodeStats: serialNode.stats,
        nodeIterations: serialNode.iterations, nodeMaximumIterations: serialNode.MAX_ITERATIONS })
    }
    console.log(JSON.stringify({ sample: "sample001", nodeCount: params.nodePortPoints.length,
      batchedNodes: parallel.stats.parallelBatchedNodeCount, batches: parallel.stats.parallelNodeBatchCount,
      singletonNodes: parallel.stats.parallelNodeSingletonCount, workerTasks: pool.stats.tasksCompleted }))
  } finally { pool.dispose() }
})

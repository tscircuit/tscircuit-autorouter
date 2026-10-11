import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("authentic four-worker A13 search preserves whole 001 and 005 native HD routes, caps and counters", async (): Promise<void> => {
  for (const sample of [1, 5]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample, 1)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, { effort: 1, cacheProvider: null })
    while (pipeline.getCurrentPhase() !== "highDensityRouteSolver" && !pipeline.solved && !pipeline.failed) pipeline.step()
    expect(pipeline.failed).toBe(false)
    const stage = pipeline.pipelineDef.find(entry => entry.solverName === "highDensityRouteSolver")!
    const [input] = stage.getConstructorParams(pipeline)
    const params = input as Pipeline9HighDensitySolverParams
    getGlobalInMemoryCache().clearCache()
    const native = new Pipeline9HighDensitySolver(params)
    native.solve()
    expect(native.solved).toBe(true)
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
    try {
      const parallel = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool })
      while (!parallel.solved && !parallel.failed) {
        parallel.step()
        if (parallel.pendingEffects?.length) await Promise.all(parallel.pendingEffects.map(effect => effect.promise))
      }
      expect(parallel.error).toBeNull()
      expect(parallel.solved).toBe(true)
      expect(parallel.routes).toEqual(structuredClone(native.routes))
      expect(parallel.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      for (const [key, value] of Object.entries(native.stats)) expect(parallel.stats[key]).toEqual(value)
      expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
      expect(pool.stats.tasksStarted).toBe(pool.stats.tasksCompleted)
      expect(parallel.stats.parallelNodesCompleted).toBe(params.nodePortPoints.length)
    } finally { pool.dispose() }
  }
})

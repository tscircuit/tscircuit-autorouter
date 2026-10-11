import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import type { ParallelHighDensityNodeBatchResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityNodeBatching"
import type { Pipeline9LocalWorkerJob, Pipeline9ParallelHighDensityNodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import type { GridHistoryJob, GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

class RecordingGridHistoryPool extends Pipeline9LocalWorkerPool {
  readonly nodeResults = new Map<string, Pipeline9ParallelHighDensityNodeResult>()
  readonly histories: Array<{ job: GridHistoryJob; history: GridHistoryResult }> = []

  override async run<T>(job: Pipeline9LocalWorkerJob): Promise<T> {
    const result = await super.run<T>(job)
    if (job.kind === "highDensityNode") {
      this.nodeResults.set(job.nodeWithPortPoints.capacityMeshNodeId, result as Pipeline9ParallelHighDensityNodeResult)
    } else if (job.kind === "highDensityNodeBatch") {
      for (const entry of (result as ParallelHighDensityNodeBatchResult).results) this.nodeResults.set(entry.nodeId, entry.result)
    } else if (job.kind === "gridHistory") this.histories.push({ job, history: result as GridHistoryResult })
    return result
  }
}

test("four actual workers preserve whole SRJ18 001/005 HD outputs, original per-node counters and caps with grid histories", async (): Promise<void> => {
  let historyJobs = 0
  let capturedHardNodeHistory = false
  for (const sample of [1, 5]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample, 1)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
    while (pipeline.getCurrentPhase() !== "highDensityRouteSolver" && !pipeline.solved && !pipeline.failed) pipeline.step()
    expect(pipeline.failed).toBe(false)
    const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "highDensityRouteSolver")
    if (!stage) throw new Error("Grid history parity requires the original HD stage")
    const [params] = stage.getConstructorParams(pipeline) as [Pipeline9HighDensitySolverParams]
    expect(params.fixedHdRoutes).toHaveLength(0)
    getGlobalInMemoryCache().clearCache()
    const native = new Pipeline9HighDensitySolver(params)
    native.solve()
    expect(native.solved).toBe(true)
    const pool = new RecordingGridHistoryPool({ workerCount: 4 })
    try {
      const parallel = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool })
      while (!parallel.solved && !parallel.failed) {
        parallel.step()
        if (parallel.pendingEffects?.length) await Promise.all(parallel.pendingEffects.map((effect) => effect.promise))
      }
      expect(parallel.solved).toBe(true)
      expect(parallel.failed).toBe(false)
      expect(parallel.routes).toEqual(structuredClone(native.routes))
      expect(parallel.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      for (const [key, value] of Object.entries(native.stats)) expect(parallel.stats[key]).toEqual(value)
      expect(pool.stats.maxActiveWorkers).toBe(4)
      expect(pool.nodeResults.size).toBe(params.nodePortPoints.length)
      for (const node of params.nodePortPoints) {
        getGlobalInMemoryCache().clearCache()
        const original = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [node] })
        original.solve()
        expect(original.solved).toBe(true)
        expect(pool.nodeResults.get(node.capacityMeshNodeId)).toEqual({ status: "solved",
          routes: structuredClone(original.routes), nodeStats: original.stats,
          nodeIterations: original.iterations, nodeMaximumIterations: original.MAX_ITERATIONS })
      }
      // Unused speculative jobs can still be finishing after the last owner;
      // warmup waits for those cancelled workers before inspecting work totals.
      await pool.warmup()
      for (const { job, history } of pool.histories) {
        expect(history.initial.maxIterations).toBe(job.maxIterations)
        expect(history.initial.iterations).toBe(0)
        expect(history.checkpoints.every((checkpoint) => checkpoint.maxIterations === job.maxIterations)).toBe(true)
        expect(history.checkpoints.length).toBeLessThanOrEqual(Math.ceil(job.maxIterations / 100))
        if (job.params.nodeWithPortPoints.capacityMeshNodeId === "cmn_45") capturedHardNodeHistory = true
      }
      historyJobs += pool.stats.gridHistoryJobsStarted
      expect(pool.stats.gridHistoryEquivalentLogicalIterationsReplayed).toBeLessThanOrEqual(pool.stats.gridHistoryLogicalIterationsReplayed)
      if (sample === 1) {
        expect(pool.stats.gridHistoryLogicalIterationsReplayed).toBe(0)
        expect(pool.stats.gridHistoryEquivalentCandidatesAdmitted).toBe(0)
      } else {
        expect(pool.stats.gridHistoryJobsStarted).toBe(5)
        expect(pool.stats.gridHistoryComputedIterations).toBe(712_799)
        expect(pool.stats.gridHistoryEquivalentCandidatesAdmitted).toBe(2)
        expect(pool.stats.gridHistoryEquivalentLogicalIterationsReplayed).toBeGreaterThan(0)
      }
      console.log(JSON.stringify({ sample, nodes: params.nodePortPoints.length,
        gridHistoryJobs: pool.stats.gridHistoryJobsStarted, gridHistoryIterations: pool.stats.gridHistoryComputedIterations,
        gridHistoryPrefixIterationsRecomputed: pool.stats.gridHistoryPrefixIterationsRecomputed,
        gridHistoryLogicalIterationsReplayed: pool.stats.gridHistoryLogicalIterationsReplayed,
        gridHistoryEquivalentLogicalIterationsReplayed: pool.stats.gridHistoryEquivalentLogicalIterationsReplayed,
        gridHistoryEquivalentCandidatesAdmitted: pool.stats.gridHistoryEquivalentCandidatesAdmitted,
        gridHistoryDenied: pool.stats.gridHistoryRequestsDenied }))
    } finally { pool.dispose() }
  }
  expect(historyJobs).toBeGreaterThan(0)
  expect(capturedHardNodeHistory).toBe(true)
})

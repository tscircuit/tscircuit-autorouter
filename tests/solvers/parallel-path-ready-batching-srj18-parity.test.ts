import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelMultiSimplifiedPathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { restoreWorkerConnectivityMap } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/restoreWorkerConnectivityMap"
import type { ParallelPathWaveContext } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import type { Pipeline9LocalWorkerJob } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"

type Capture = ParallelPathWaveContext["params"] & Omit<ParallelPathWaveContext, "params">
class CountingPool extends Pipeline9LocalWorkerPool {
  readonly batches: number[][] = []
  override run<T>(job: Pipeline9LocalWorkerJob): Promise<T> {
    if (job.kind === "simplifyPathWave") this.batches.push([...job.indexes])
    return super.run<T>(job)
  }
}

test("batched ready paths preserve full captured srj18 native phase geometry, steps, budgets and four-worker limit", async (): Promise<void> => {
  const pool = new CountingPool({ workerCount: 4 })
  try {
    for (const sample of [1, 6, 14, 15]) {
      const data = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL(
        `../fixtures/parallel-path-batching/sample${String(sample).padStart(3, "0")}.json.gz`, import.meta.url,
      )))).toString()) as Capture
      const { connectivityNetMap, connectivityIdToNetMap, ...params } = data
      const config = { ...params, connMap: restoreWorkerConnectivityMap({ connectivityNetMap, connectivityIdToNetMap }) }
      const native = new MultiSimplifiedPathSolver(config)
      native.solve()
      const before = pool.batches.length
      const parallel = new ParallelMultiSimplifiedPathSolver({ ...config, workerPool: pool, workerCount: 4 })
      await parallel.solveAsync()
      expect(native.solved, native.error ?? "").toBe(true)
      expect(parallel.solved, parallel.error ?? "").toBe(true)
      expect(parallel.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
      expect(parallel.stats.nativePathSteps).toBe(native.iterations)
      expect(parallel.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      expect(parallel.currentUnsimplifiedHdRouteIndex).toBe(native.currentUnsimplifiedHdRouteIndex)
      const batches = pool.batches.slice(before)
      const indexes = batches.flat()
      expect(indexes.sort((left, right) => left - right)).toEqual(params.unsimplifiedHdRoutes.map((_, index) => index))
      expect(batches.length).toBeLessThan(params.unsimplifiedHdRoutes.length)
      expect(batches.some((batch) => batch.length > 1)).toBe(true)
      for (const batch of batches) expect(batch).toEqual([...batch].sort((left, right) => left - right))
    }
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(pool.stats.tasksCompleted).toBe(pool.stats.tasksStarted)
  } finally { pool.dispose() }
})

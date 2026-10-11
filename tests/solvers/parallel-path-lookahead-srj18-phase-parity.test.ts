import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { restoreWorkerConnectivityMap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/restoreWorkerConnectivityMap"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { ParallelPathWaveContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"

type Capture = { sample: number; phase: number; input: ParallelPathWaveContext["params"] & {
  connectivityNetMap: Record<string, string[]>; connectivityIdToNetMap: Record<string, string> } }

test("six captured SRJ18 phases preserve all native route geometry, ordered steps and phase budgets with four workers", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const encoded = await Bun.file(new URL("../fixtures/parallel-path-lookahead/srj18-native-phases.json.gz", import.meta.url)).arrayBuffer()
  const captures = JSON.parse(gunzipSync(new Uint8Array(encoded)).toString()) as Capture[]
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport: "bun-shared" })
  let routes = 0
  let certified = 0
  let reruns = 0
  const counts: Array<{ sample: number; phase: number; routes: number; nativeSteps: number; nativeGeometryHash: string; parallelGeometryHash: string; stats: Record<string, unknown> }> = []
  try {
    for (const capture of captures) {
      const { connectivityNetMap, connectivityIdToNetMap, ...params } = capture.input
      const context = { params, connectivityNetMap, connectivityIdToNetMap }
      const before = structuredClone(context)
      const config = { ...params, connMap: restoreWorkerConnectivityMap(context) }
      const native = new MultiSimplifiedPathSolver(config)
      native.solve()
      expect(native.solved).toBe(true)
      expect(native.failed).toBe(false)
      const parallel = new ParallelMultiSimplifiedPathSolver({ ...config, workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
      await parallel.solveAsync()
      expect(parallel.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
      expect(parallel.iterations).toBe(native.iterations)
      expect(parallel.stats.nativePathSteps).toBe(native.iterations)
      expect(parallel.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      expect(parallel.currentUnsimplifiedHdRouteIndex).toBe(native.currentUnsimplifiedHdRouteIndex)
      expect(parallel.activeSubSolver).toBe(null)
      expect(parallel.progress).toBe(native.progress)
      expect(parallel.error).toBe(native.error)
      expect(parallel.stats.lookaheadSpeculativeJobs).toBe(params.unsimplifiedHdRoutes.length)
      expect(parallel.stats.lookaheadMaximumLookahead).toBe(16)
      expect(context).toEqual(before)
      routes += params.unsimplifiedHdRoutes.length
      certified += parallel.stats.lookaheadCertifiedRoutes
      reruns += parallel.stats.lookaheadOrderedReruns
      counts.push({ sample: capture.sample, phase: capture.phase, routes: params.unsimplifiedHdRoutes.length,
        nativeSteps: native.iterations,
        nativeGeometryHash: createHash("sha256").update(JSON.stringify(native.simplifiedHdRoutes)).digest("hex"),
        parallelGeometryHash: createHash("sha256").update(JSON.stringify(parallel.simplifiedHdRoutes)).digest("hex"), stats: { ...parallel.stats } })
    }
    expect(captures.map((capture) => [capture.sample, capture.phase])).toEqual([[1, 1], [6, 1], [14, 1], [15, 1], [5, 1], [5, 2]])
    expect(routes).toBe(1503)
    expect(certified + reruns).toBe(routes)
    expect(certified).toBeGreaterThan(1000)
    expect(reruns).toBeGreaterThan(0)
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(pool.stats.tasksCompleted).toBe(routes)
    if (process.env.PARALLEL_PATH_LOOKAHEAD_COUNTS) await Bun.write(process.env.PARALLEL_PATH_LOOKAHEAD_COUNTS, JSON.stringify(counts, null, 2))
  } finally { pool.dispose() }
})

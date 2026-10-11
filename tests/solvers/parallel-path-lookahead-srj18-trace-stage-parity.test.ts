import { expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelTraceSimplificationSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { restoreWorkerConnectivityMap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/restoreWorkerConnectivityMap"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"

type Params = ConstructorParameters<typeof TraceSimplificationSolver>[0]
type Capture = { sample: number; connectivityNetMap: Record<string, string[]>; connectivityIdToNetMap: Record<string, string>;
  params: Omit<Params, "connMap" | "netByConnectionName" | "terminalLayerIndicesByPcbPortId"> & {
    netByConnectionName: Array<[string, string]>; terminalLayerIndicesByPcbPortId: Array<[string, number[]]> } }

test("complete native sample001 and sample005 simplification stages retain all phases and geometry with certified lookahead", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const encoded = await Bun.file(new URL("../fixtures/parallel-path-lookahead/srj18-native-trace-stages.json.gz", import.meta.url)).arrayBuffer()
  const captures = JSON.parse(gunzipSync(new Uint8Array(encoded)).toString()) as Capture[]
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport: "bun-shared" })
  try {
    for (const capture of captures) {
      const config: Params = { ...capture.params, netByConnectionName: new Map(capture.params.netByConnectionName),
        terminalLayerIndicesByPcbPortId: new Map(capture.params.terminalLayerIndicesByPcbPortId.map(([id, layers]) => [id, new Set(layers)])),
        connMap: restoreWorkerConnectivityMap(capture) }
      const before = structuredClone(config.hdRoutes)
      const serial = new TraceSimplificationSolver(config)
      serial.solve()
      const parallel = new ParallelTraceSimplificationSolver({ ...config, workerPool: pool, workerCount: 4 })
      await parallel.solveAsync()
      expect(serial.solved).toBe(true)
      expect(serial.failed).toBe(false)
      expect(parallel.solved).toBe(true)
      expect(parallel.failed).toBe(false)
      expect(parallel.error).toBe(serial.error)
      expect(parallel.simplifiedHdRoutes).toEqual(serial.simplifiedHdRoutes)
      expect(parallel.simplificationPipelineLoops).toBe(serial.simplificationPipelineLoops)
      expect(parallel.MAX_SIMPLIFICATION_PIPELINE_LOOPS).toBe(serial.MAX_SIMPLIFICATION_PIPELINE_LOOPS)
      expect(parallel.MAX_ITERATIONS).toBe(serial.MAX_ITERATIONS)
      expect(parallel.currentPhase).toBe(serial.currentPhase)
      expect(parallel.stats.lookaheadCertifiedRoutes).toBeGreaterThan(0)
      expect(parallel.stats.lookaheadSpeculativeJobs).toBeGreaterThan(config.hdRoutes.length)
      expect(parallel.stats.lookaheadMaximumLookahead).toBe(4)
      expect(parallel.stats.lookaheadGuardChecks).toBeLessThan(parallel.stats.lookaheadSpeculativeJobs / 2)
      expect(config.hdRoutes).toEqual(before)
    }
    expect(captures.map((capture) => capture.sample)).toEqual([1, 5])
    expect(pool.stats.maxActiveWorkers).toBe(4)
  } finally { pool.dispose() }
})

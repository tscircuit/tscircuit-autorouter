import { expect, test } from "bun:test"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("shared immutable contexts preserve complete SRJ18 001 and 005 native-transport geometry", async (): Promise<void> => {
  const counts: Array<Record<string, number>> = []
  for (const sample of [1, 5]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample, 1)
    const outputs: unknown[] = []
    for (const contextTransport of ["structured-clone", "bun-shared"] as const) {
      getGlobalInMemoryCache().clearCache()
      const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport })
      const solver = new AutoroutingPipelineSolver9_Parallel(structuredClone(scenario), {
        effort: 1, cacheProvider: null, workerPool: pool, enableParallelPathSimplification: true,
      })
      try {
        await solver.solveAsync()
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        outputs.push(solver.getOutputSimplifiedPcbTraces())
        expect(pool.stats.maxActiveWorkers).toBe(4)
        expect(pool.stats.tasksCompleted).toBe(pool.stats.tasksStarted)
        if (contextTransport === "bun-shared") {
          expect(pool.stats.contextSerializationCalls).toBeGreaterThan(0)
          expect(pool.stats.contextSerializedBytes).toBeGreaterThan(0)
          expect(pool.stats.sharedContextMessages).toBeGreaterThan(pool.stats.contextSerializationCalls)
          counts.push({ sample, contextSerializationCalls: pool.stats.contextSerializationCalls,
            contextSerializedBytes: pool.stats.contextSerializedBytes, sharedContextMessages: pool.stats.sharedContextMessages,
            contextAliasNativeMessages: pool.stats.contextAliasNativeMessages, contextShapeNativeMessages: pool.stats.contextShapeNativeMessages })
        }
      } finally { pool.dispose() }
    }
    expect(outputs[1]).toEqual(outputs[0])
  }
  console.log("Shared context functional counts", JSON.stringify(counts))
})

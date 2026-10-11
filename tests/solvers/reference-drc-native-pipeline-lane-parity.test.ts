import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import stringify from "fast-json-stable-stringify"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineSolver9_Parallel } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { getNativeSyncReferencePoolBinding } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { SimpleRouteJson } from "../../lib/types"

test("actual pipeline async entry points retain Native ordered geometry while original private DRC consumes four-core facts", async () => {
  const input = await Bun.file(new URL("../../node_modules/dataset-srj18/samples/sample001.json", import.meta.url)).json() as SimpleRouteJson
  const original = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { effort: 1, cacheProvider: null })
  original.solve()
  expect(original.solved).toBe(true)
  expect(original.failed).toBe(false)
  const parallel = new AutoroutingPipelineSolver9_Parallel(structuredClone(input), { effort: 1, cacheProvider: null,
    workerCount: 4, pathingStrategy: "indexed", enableParallelDrcTrials: false, enableParallelPathSimplification: true })
  try {
    await parallel.stepAsync()
    await parallel.solveUntilPhaseAsync("portPointPathingSolver")
    await parallel.solveAsync()
    expect(parallel.solved).toBe(true)
    expect(parallel.failed).toBe(false)
    expect(parallel.getOutputSimplifiedPcbTraces()).toEqual(original.getOutputSimplifiedPcbTraces())
    const geometry = stringify(parallel.getOutputSimplifiedPcbTraces())!
    expect(createHash("sha256").update(geometry).digest("hex")).toBe("a4c788251b5f5829d22c487487090a9a898a7cffee5fe96ca767440478b8c049")
    const ledger = getNativeSyncReferencePoolBinding(parallel.workerPool)!.book
    expect(ledger.stats.batchesCompleted).toBeGreaterThan(0)
    expect(ledger.stats.factRowsCompleted).toBeGreaterThan(0)
    expect(ledger.stats.mainFactRowsCompleted).toBeGreaterThan(0)
    expect(ledger.stats.workersReserved).toBe(ledger.stats.workersRetired)
    expect(ledger.stats.protocolFailures).toBe(0)
    expect(parallel.workerPool.stats.tasksStarted).toBe(parallel.workerPool.stats.tasksCompleted)
    expect(parallel.workerPool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally { parallel.dispose() }
})

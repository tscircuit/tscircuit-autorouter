import { expect, test } from "bun:test"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("the parallel pipeline retains complete SRJ18 sample 16 routing geometry", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 16)
  getGlobalInMemoryCache().clearCache()
  const serial = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  serial.solve()
  expect(serial.solved).toBe(true)
  getGlobalInMemoryCache().clearCache()
  const parallel = new AutoroutingPipelineSolver9_Parallel(structuredClone(scenario), { effort: 1, cacheProvider: null, workerCount: 4, enableParallelPathSimplification: true })
  try {
    await parallel.solveAsync()
    expect(parallel.solved).toBe(true)
    expect(parallel.failed).toBe(false)
    expect(parallel.getOutputSimplifiedPcbTraces()).toEqual(serial.getOutputSimplifiedPcbTraces())
    expect(Object.keys(parallel.timeSpentOnPhase)).toEqual(Object.keys(serial.timeSpentOnPhase))
    expect(parallel.workerPool.stats.maxActiveWorkers).toBe(4)
  } finally { parallel.dispose() }
})

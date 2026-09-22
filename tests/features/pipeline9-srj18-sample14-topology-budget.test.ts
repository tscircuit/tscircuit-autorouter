import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("sample 14 completes topology with cramped-port preferences at normal effort", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )
  while (!pipeline.failed && !pipeline.portPointPathingSolver?.solved) {
    pipeline.step()
  }
  expect(pipeline.failed).toBe(false)
  expect(pipeline.portPointPathingSolver?.solved).toBe(true)
})

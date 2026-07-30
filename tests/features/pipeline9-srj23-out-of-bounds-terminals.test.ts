import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 routes SRJ23 samples with terminals outside the declared bounds", async () => {
  for (const sampleNumber of [101, 107]) {
    const { scenario } = await loadScenarioBySampleNumber("srj23", sampleNumber)
    const originalBounds = { ...scenario.bounds }
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      {
        cacheProvider: null,
        effort: 1,
      },
    )

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(scenario.bounds).toEqual(originalBounds)
  }
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 routes srj23 samples with connected pads beyond implicit bounds", async () => {
  for (const sampleNumber of [101, 107]) {
    const { scenario } = await loadScenarioBySampleNumber("srj23", sampleNumber)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      scenario,
      {
        cacheProvider: null,
        effort: 0.1,
      },
    )
    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(
      solver.preprocessSimpleRouteJsonSolver?.getOutputSimpleRouteJson().bounds,
    ).not.toEqual(scenario.bounds)
    expect(solver.originalSrj.bounds).toEqual(scenario.bounds)
  }
})

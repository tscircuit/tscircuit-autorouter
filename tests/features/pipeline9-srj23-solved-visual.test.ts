import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const SAMPLE_NUMBERS = [1, 3, 10]

test("Pipeline9 visually solves representative SRJ23 samples", async () => {
  for (const sampleNumber of SAMPLE_NUMBERS) {
    const { scenario, scenarioName } = await loadScenarioBySampleNumber(
      "srj23",
      sampleNumber,
    )
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      {
        cacheProvider: null,
        effort: 1,
        visualizationTraceColorMode: "net",
      },
    )

    solver.solve()

    expect(scenario.traces?.length).toBeGreaterThan(0)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    await expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
      {
        svgName: scenarioName,
        // Circuit 10 selects a different equal-cost route on Linux.
        tolerance: sampleNumber === 10 ? 0.035 : 0.01,
      },
    )
  }
})

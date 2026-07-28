import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const SAMPLE_NUMBERS = [1, 10, 23]

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

    const { errors } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      traces: solver.getOutputSimplifiedPcbTraces(),
    })
    expect(errors).toHaveLength(0)

    const svg = getSvgFromGraphicsObject(solver.visualizeFinalOutput(), {
      backgroundColor: "white",
      svgWidth: 640,
      svgHeight: 640,
    })
    await expect(svg).toMatchSvgSnapshot(import.meta.path, {
      svgName: scenarioName,
    })
  }
})

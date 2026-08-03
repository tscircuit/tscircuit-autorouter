import { expect, setDefaultTimeout, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const SAMPLE_NUMBERS = [1, 3, 10]

setDefaultTimeout(180_000)

for (const sampleNumber of SAMPLE_NUMBERS) {
  test(`Pipeline9 visually solves SRJ23 sample ${sampleNumber}`, async () => {
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

    const snapshotPath =
      process.platform === "linux" && sampleNumber === 10
        ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
        : import.meta.path
    await expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      snapshotPath,
      {
        svgName: scenarioName,
      },
    )
  })
}

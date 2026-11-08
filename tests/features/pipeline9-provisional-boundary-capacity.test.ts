import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("unfixed SRJ18 boards retain provisional crossings for regional routing", async (): Promise<void> => {
  for (const sample of [14, 15]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
    const original = JSON.stringify(scenario)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      { cacheProvider: null, effort: 1 },
    )
    while (!solver.uniformPortDistributionSolver && !solver.failed)
      solver.step()
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.portPointPathingSolver!.solved).toBeTrue()
    expect(
      solver.portPointPathingSolver!.getConstructorParams()[0].portGeometry,
    ).toBeUndefined()
    expect(JSON.stringify(scenario)).toBe(original)
  }
})

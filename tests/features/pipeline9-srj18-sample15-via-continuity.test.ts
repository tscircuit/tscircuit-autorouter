import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves via continuity while repairing SRJ18 sample 15", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 15)
  const input = structuredClone(scenario)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toHaveLength(0)
  expect(input).toEqual(scenario)
})

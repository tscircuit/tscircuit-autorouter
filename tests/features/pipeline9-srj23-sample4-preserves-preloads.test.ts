import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 routes SRJ23 sample 4 without rerouting existing copper", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 4)
  expect(scenario.traces).toHaveLength(9)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  // Correctly compacted free regions no longer require regional rerouting.
  // Contiguous fallback/splicing remains covered by the high-density unit test.
  expect(
    Number(solver.highDensityRouteSolver?.stats.fallbackNodeCount),
  ).toBe(0)
  expect(solver.getMutatedPreloadedTraces()).toHaveLength(0)
  expect(solver.getUpdatedPreloadedTraces()).toEqual(scenario.traces!)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})

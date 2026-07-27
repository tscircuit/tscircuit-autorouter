import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 completes srj23 sample 100 with preloaded ports", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 100)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    cacheProvider: null,
    effort: 1,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.preloadedTraceGraphSolver?.stats).toMatchObject({
    topologyChanged: false,
    inputBoundaryCount:
      solver.preloadedTraceGraphSolver?.stats.outputBoundaryCount,
    inputPortCount: solver.preloadedTraceGraphSolver?.stats.outputPortCount,
  })
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      traces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toEqual([])
})

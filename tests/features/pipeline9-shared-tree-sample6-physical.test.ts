import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("real sample6 preserves shared-tree physical clearance under relaxed and declared board rules", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const input = { inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces }
  expect(evaluateRelaxedDrc(input).errors).toEqual([])
  expect(evaluateRelaxedDrc({ ...input, includeBoardClearance: true }).errors).toEqual([])
  expect(evaluateRelaxedDrc({ ...input, includeBoardClearance: true, drcOptions: {
    traceClearance: scenario.minTraceToPadEdgeClearance ?? 0.1,
    viaClearance: scenario.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
  } }).errors).toEqual([])
})

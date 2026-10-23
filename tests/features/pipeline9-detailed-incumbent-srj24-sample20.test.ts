import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("real SRJ24 sample20 retains native coarse feasibility and complete work evidence through feedback budget finalization", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 20)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { cacheProvider: null, effort: 1 })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.detailedRoutingFeedback.stats.detailedFeedbackReplanCount).toBeGreaterThan(0)
  expect(solver.portPointPathingSolver!.stats.detailedIncumbentInstalled).toBe(1)
  expect(solver.portPointPathingSolver!.stats.detailedIncumbentAcceptedAtNativeBudget).toBe(1)
  expect(solver.portPointPathingSolver!.stats.detailedFeedbackTotalDetailedIterations).toBeGreaterThan(0)
  expect(evaluateRelaxedDrc({ inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces() }).errors).toEqual([])
})

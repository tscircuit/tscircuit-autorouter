import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("real SRJ18 sample14 preserves a complete coarse incumbent when a feedback refinement reaches its original native budget", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14)
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

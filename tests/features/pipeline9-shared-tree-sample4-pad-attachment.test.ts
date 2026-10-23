import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("real sample4 retains original demands while a certified pad attachment avoids a nonexistent copper branch", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 4)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  const metrics: Record<string, unknown> = solver.portPointPathingSolver!.getSolveGraphBenchmarkMetrics()!
  expect(metrics.electricalTreeCertifiedPadAttachmentCount).toBeGreaterThan(0)
  expect(metrics.electricalTreeVerifiedDemandCount).toBe(solver.srjWithPointPairs!.connections.length)
  expect(evaluateRelaxedDrc({ inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces() }).errors).toEqual([])
})

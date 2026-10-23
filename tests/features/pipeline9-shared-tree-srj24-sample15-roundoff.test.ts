import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("real SRJ24 sample15 publishes exact shared junctions after native roundoff conversion and fresh DRC validation", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 15)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.pipeline9JointDrcRepairSolver!.stats.electricalTreeNormalizedEndpoints).toBeGreaterThan(0)
  expect(solver.pipeline9JointDrcRepairSolver!.stats.electricalTreeEndpointNormalizationDrcChecks).toBe(2)
  expect(solver.pipeline9JointDrcRepairSolver!.stats.electricalTreeEndpointNormalizationMaxDisplacement).toBeLessThan(1e-9)
  expect(() => solver.getRoutingConnections()).not.toThrow()
  expect(evaluateRelaxedDrc({ inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces() }).errors).toEqual([])
})

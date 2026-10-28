import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("SRJ24 sample 25 preserves physical forest junctions and original final reference rules after regional native routing", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 25)
  const inputBefore = JSON.stringify(scenario)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), {
    effort: 1, cacheProvider: null, usePhysicalNetForest: true,
  })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.physicalNetForestSolver!.diagnostics.physicallyValidatedNets).toBe(3)
  expect(solver.physicalNetForestSolver!.diagnostics.interiorAttachments).toBe(3)
  expect(solver.highDensityRouteSolver!.benchmarkDiagnosticCounters.regionalNativeRouteInstances).toBeGreaterThan(0)
  const input = { inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces() }
  expect(evaluateRelaxedDrc(input).errors).toEqual([])
  expect(evaluateRelaxedDrc({ ...input, includeBoardClearance: true }).errors).toEqual([])
  expect(evaluateRelaxedDrc({ ...input, includeBoardClearance: true,
    drcOptions: { traceClearance: scenario.minTraceToPadEdgeClearance, viaClearance: scenario.minViaHoleEdgeToViaHoleEdgeClearance } }).errors).toEqual([])
  expect(JSON.stringify(scenario)).toBe(inputBefore)
})

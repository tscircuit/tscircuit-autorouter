import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("parametric routing preserves sample9 physical connectivity after the complete repair sequence", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario), { effort: 1, cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.highDensityRouteSolver!.stats.parametricCompiledNodeCount).toBeGreaterThan(0)
  expect(solver.pipeline9JointDrcRepairSolver!.stats.finalDrcIssueCount).toBe(0)
  const output = solver.getOutputSimpleRouteJson()
  expect(new Set(output.traces!.map((trace) => trace.pcb_trace_id)).size).toBe(output.traces!.length)
  expect(evaluateRelaxedDrc({
    inputSrj: output, srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: [], includeBoardClearance: true,
  }).errors).toEqual([])
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("real sample13 keeps shared tree pads immutable through terminal escape, whole-branch repair and cleanup", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 13)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.pipeline9JointDrcRepairSolver!.stats.terminalEscapeCandidateCount).toBeGreaterThan(0)
  expect(() => assertSharedElectricalTreeRoutes({ connections: solver.getRoutingConnections(),
    routes: solver._getOutputHdRoutes(), layerCount: scenario.layerCount })).not.toThrow()
  expect(evaluateRelaxedDrc({ inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces() }).errors).toEqual([])
})

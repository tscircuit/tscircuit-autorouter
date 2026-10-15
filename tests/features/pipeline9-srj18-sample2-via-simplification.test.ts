import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 simplifies repaired SRJ18 sample 2 at default effort", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 2)
  const input = structuredClone(scenario)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 1,
    cacheProvider: null,
  })
  solver.solveUntilPhase("effortCleanupSolver")
  const repairedViaCount = solver
    .pipeline9JointDrcRepairSolver!.getOutput()
    .reduce((sum, route) => sum + route.vias.length, 0)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.effortCleanupSolver!.completedPasses).toBeGreaterThanOrEqual(1)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const simplifiedViaCount = routedTraces.reduce(
    (sum, trace) =>
      sum + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )
  expect(simplifiedViaCount).toBeLessThan(repairedViaCount)
  expect(simplifiedViaCount).toBeLessThanOrEqual(510)
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      includeBoardClearance: true,
      drcOptions: {
        traceClearance: scenario.minTraceToPadEdgeClearance ?? 0.1,
        viaClearance: scenario.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
      },
    }).errors,
  ).toHaveLength(0)
  expect(input).toEqual(scenario)
})

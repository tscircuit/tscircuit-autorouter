import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "scripts/benchmark/scenarios"

test("Pipeline7 improves srj20 sample169 region cost and remains DRC-clean", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj20", 169)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario)

  solver.solve()

  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  const optimizer =
    solver.portPointPathingSolver?.getSolveGraphBenchmarkMetrics()?.optimizer
  const viaCount = routedTraces.reduce(
    (sum, trace) =>
      sum + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )

  expect(optimizer).toBeDefined()
  expect(optimizer!.finalMaxRegionCost).toBeLessThan(
    optimizer!.initialMaxRegionCost,
  )
  expect(optimizer!.finalTotalRegionCost).toBeLessThan(
    optimizer!.initialTotalRegionCost,
  )
  expect(optimizer!.downstreamRiskImproved).toBe(true)
  expect(optimizer!.acceptedMutationCount).toBeGreaterThan(0)
  expect(optimizer!.terminalKeepoutCount).toBeGreaterThan(0)
  expect(optimizer!.terminalKeepoutExactCheckCount).toBeGreaterThan(0)
  expect(errors).toHaveLength(0)
  expect(viaCount).toBe(36)
})

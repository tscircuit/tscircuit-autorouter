import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "scripts/benchmark/scenarios"

test("Pipeline7 keeps srj20 sample169 DRC-clean after multi-crossing simplification", async () => {
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
  const viaCount = routedTraces.reduce(
    (sum, trace) =>
      sum + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )

  expect(errors).toHaveLength(0)
  expect(viaCount).toBe(29)
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "scripts/benchmark/scenarios"

test("Pipeline7 reports the existing srj20 sample169 via-pad residue after simplification", async () => {
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

  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_pad_ids: [expect.any(String), "pcb_smtpad_2.000_0.400"],
    minimum_clearance: 0.1,
    actual_clearance: expect.closeTo(0.025, 8),
  })
  expect(viaCount).toBe(34)
})

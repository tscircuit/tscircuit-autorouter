import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reports the remaining SRJ18 sample 16 via-pad violation", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 16)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  // This contact was omitted by the reference checker before via-pad checks.
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_pad_ids: ["via_57", "pcb_smtpad_229"],
    minimum_clearance: 0.1,
    actual_clearance: 0,
  })
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reports remaining SRJ18 sample 12 DRC errors", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 12)
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
  // The stronger shared checker changes which repair candidates are accepted.
  // Record all remaining violations explicitly; this sample is not DRC clean.
  expect(errors).toHaveLength(8)
  expect(errors).toMatchObject([
    {
      type: "pcb_trace_error",
      pcb_trace_error_id: "overlap_source_trace_124__source_net_124_0_via_187",
    },
    {
      type: "pcb_trace_error",
      pcb_trace_error_id:
        "overlap_source_trace_53__source_net_53_mst1_0_pcb_smtpad_92",
    },
    {
      type: "pcb_trace_error",
      pcb_trace_error_id:
        "overlap_source_trace_0__source_net_0_mst191_0_via_14",
    },
    {
      type: "pcb_via_trace_clearance_error",
      pcb_via_trace_clearance_error_id:
        "via_trace_clearance_via_7_source_trace_13__source_net_13_mst7_0",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: "via_pad_clearance_via_7_pcb_smtpad_485",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: "via_pad_clearance_via_60_pcb_smtpad_231",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: "via_pad_clearance_via_61_pcb_smtpad_231",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id:
        "via_pad_clearance_via_188_pcb_smtpad_397",
    },
  ])
})

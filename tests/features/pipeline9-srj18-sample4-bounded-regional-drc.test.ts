import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reports remaining SRJ18 sample 4 DRC errors within its regional work budget", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 4)
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
  expect(errors).toHaveLength(11)
  expect(errors).toMatchObject([
    {
      type: "pcb_trace_error",
      pcb_trace_error_id:
        "overlap_source_trace_44__source_net_44_mst2_0_source_trace_15__source_net_15_0",
    },
    {
      type: "pcb_trace_error",
      pcb_trace_error_id:
        "overlap_source_trace_15__source_net_15_0_source_trace_12__source_net_12_mst1_0",
    },
    {
      type: "pcb_trace_error",
      pcb_trace_error_id:
        "overlap_source_trace_2__source_net_2_mst2_0_pcb_smtpad_5",
    },
    {
      type: "pcb_via_trace_clearance_error",
      pcb_via_trace_clearance_error_id:
        "via_trace_clearance_via_0_source_trace_15__source_net_15_0",
    },
    {
      type: "pcb_via_trace_clearance_error",
      pcb_via_trace_clearance_error_id:
        "via_trace_clearance_via_70_source_trace_15__source_net_15_0",
    },
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_pad_trace_clearance_error_id:
        "pad_trace_clearance_pcb_plated_hole_16_source_trace_12__source_net_12_mst1_0",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id:
        "via_pad_clearance_via_0_pcb_plated_hole_17",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id:
        "via_pad_clearance_via_70_pcb_plated_hole_16",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: "via_pad_clearance_via_107_pcb_smtpad_38",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: "via_pad_clearance_via_122_pcb_smtpad_66",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: "via_pad_clearance_via_124_pcb_smtpad_66",
    },
  ])
  const stats = solver.pipeline9JointDrcRepairSolver!.stats
  expect(
    Number(stats.boundedRegionalRepairAttemptedRegionCount),
  ).toBeLessThanOrEqual(4)
  expect(
    Number(stats.boundedRegionalRepairCandidateAttemptCount),
  ).toBeLessThanOrEqual(1_024)
  expect(
    Number(stats.boundedRegionalRepairPathSearchNodeCount),
  ).toBeLessThanOrEqual(480_000)
  // Node-local repair changes the input to both regional passes; this fixture
  // now needs 11 reference checks while retaining the same search-work limits.
  expect(
    Number(stats.boundedRegionalRepairReferenceValidationCount),
  ).toBeLessThanOrEqual(11)
})

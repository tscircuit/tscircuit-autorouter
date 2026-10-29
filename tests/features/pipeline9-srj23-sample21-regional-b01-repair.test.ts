import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 keeps the current SRJ23 regional repair residue bounded", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 21)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .regionalB01RepairPreloadEligibleDrcIssueCount,
  ).toBeLessThanOrEqual(1)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  // Trace errors are repaired; the complete reference check reports one via
  // between two neighboring pads as the remaining bounded-repair residue.
  expect(errors).toHaveLength(2)
  expect(errors).toMatchObject([
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_ids: [expect.any(String), "pcb_smtpad_41"],
      pcb_trace_id: "source_net_4_mst0_0_routed",
      minimum_clearance: 0.1,
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_ids: [expect.any(String), "pcb_smtpad_42"],
      pcb_trace_id: "source_net_4_mst0_0_routed",
      minimum_clearance: 0.1,
    },
  ])
})

import {
  checkPadTraceClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 8's crowded trace/via clearances", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 8)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const { errors, circuitJson } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
  // A wider diagnostic radius reports physical gaps even after relaxed DRC
  // accepts them. Keep this independent of the repair's margin evaluator.
  const measuredPairs = new Map(
    [
      ...checkViaTraceClearance(circuitJson, { minClearance: 0.2 }),
      ...checkPadTraceClearance(circuitJson, { minClearance: 0.2 }),
    ].map((error) => [
      `${error.type === "pcb_via_trace_clearance_error" ? error.pcb_via_id : error.pcb_pad_id}/${error.pcb_trace_id}`,
      error.actual_clearance,
    ]),
  )
  for (const pair of [
    "via_58/source_trace_44__source_net_44_mst4_0",
    "via_80/source_trace_48__source_net_48_mst0_0",
    "via_250/source_trace_39__source_net_39_mst3_0",
    "pcb_smtpad_50/source_trace_48__source_net_48_mst0_0",
    "pcb_smtpad_312/source_trace_31__source_net_31_mst4_0",
  ]) {
    expect(measuredPairs.get(pair)).toBeGreaterThanOrEqual(0.11)
  }
  const repairStats = solver.pipeline9JointDrcRepairSolver!.stats
  expect(repairStats.clearancePrecisionRepaired).toBeTrue()
  expect(repairStats.clearancePrecisionReferenceValidationCount).toBe(1)
  expect(
    Number(repairStats.clearancePrecisionCandidateValidationCount),
  ).toBeLessThanOrEqual(8)
  expect(Number(repairStats.clearancePrecisionCandidateCount)).toBeGreaterThan(
    0,
  )
  expect(
    Number(repairStats.clearancePrecisionCandidateCount),
  ).toBeLessThanOrEqual(24)
})

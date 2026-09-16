import {
  checkPadTraceClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reports SRJ18 sample 8's remaining via/pad clearances", async (): Promise<void> => {
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
  expect(errors.map((error) => error.type).sort()).toEqual([
    "pcb_via_trace_clearance_error",
    "pcb_via_trace_clearance_error",
    "pcb_via_trace_clearance_error",
  ])
  // Check the reported clearance failures against the final copper geometry.
  const insufficientClearancePairs = new Set(
    [
      ...checkViaTraceClearance(circuitJson, {
        minClearance: RELAXED_DRC_OPTIONS.viaClearance! - 1e-8,
      }),
      ...checkPadTraceClearance(circuitJson, {
        minClearance: RELAXED_DRC_OPTIONS.traceClearance! - 1e-8,
      }),
    ].map(
      (error) =>
        `${error.type === "pcb_via_trace_clearance_error" ? error.pcb_via_id : error.pcb_pad_id}/${error.pcb_trace_id}`,
    ),
  )
  for (const error of errors) {
    if (error.type === "pcb_via_trace_clearance_error") {
      expect(
        insufficientClearancePairs.has(
          `${error.pcb_via_id}/${error.pcb_trace_id}`,
        ),
      ).toBeTrue()
    }
    if (error.type === "pcb_pad_trace_clearance_error") {
      expect(
        insufficientClearancePairs.has(
          `${error.pcb_pad_id}/${error.pcb_trace_id}`,
        ),
      ).toBeTrue()
    }
  }
  const repairStats = solver.pipeline9JointDrcRepairSolver!.stats
  expect(
    Number(repairStats.clearancePrecisionReferenceValidationCount),
  ).toBeLessThanOrEqual(1)
  expect(
    Number(repairStats.clearancePrecisionCandidateValidationCount),
  ).toBeLessThanOrEqual(8)
  expect(
    Number(repairStats.clearancePrecisionCandidateCount),
  ).toBeLessThanOrEqual(24)
})

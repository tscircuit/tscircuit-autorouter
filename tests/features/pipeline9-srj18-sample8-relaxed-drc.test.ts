import {
  checkPadTraceClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 8's crowded trace/via clearances", async (): Promise<void> => {
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
  const repairSolver = solver.pipeline9JointDrcRepairSolver!
  const { errors: originalErrors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: repairSolver.params.newConnections,
      originalConnections: scenario.connections,
      hdRoutes: repairSolver.exactRepairSolver!.getOutput(),
      layerCount: scenario.layerCount,
      obstacles: repairSolver.params.srj.obstacles,
      defaultViaHoleDiameter: repairSolver.params.defaultViaHoleDiameter,
      connMap: repairSolver.params.connMap,
    }),
  })
  // Check the required clearance directly: repaired contacts may move beyond
  // the diagnostic radius. Keep this independent of the repair's evaluator.
  const insufficientClearancePairs = new Set(
    [
      ...checkViaTraceClearance(circuitJson, { minClearance: 0.11 }),
      ...checkPadTraceClearance(circuitJson, { minClearance: 0.11 }),
    ].map(
      (error) =>
        `${error.type === "pcb_via_trace_clearance_error" ? error.pcb_via_id : error.pcb_pad_id}/${error.pcb_trace_id}`,
    ),
  )
  // Derive the contacts from this revision's exact output. Upstream routing
  // changes can remove a historical contact before precision repair starts.
  for (const error of originalErrors) {
    if (
      error.type !== "pcb_via_trace_clearance_error" &&
      error.type !== "pcb_pad_trace_clearance_error"
    ) {
      throw new Error(`Unexpected original DRC error: ${error.type}`)
    }
    const pair = `${error.type === "pcb_via_trace_clearance_error" ? error.pcb_via_id : error.pcb_pad_id}/${error.pcb_trace_id}`
    expect(insufficientClearancePairs.has(pair)).toBeFalse()
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

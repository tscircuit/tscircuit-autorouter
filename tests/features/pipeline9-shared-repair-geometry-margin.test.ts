import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import {
  createCleanSharedRepairCandidate,
  createSharedRepairGeometryInput,
  type SharedRepairEvaluatorAccess,
} from "../fixtures/shared-repair-geometry-input"

test("shared repair preparation preserves margin identities with distinct original arrays and retained results", (): void => {
  const solvers = [undefined, false, true].map((enabled) => new Pipeline9JointDrcRepairSolver(
    createSharedRepairGeometryInput(enabled),
  ))
  const original = createCleanSharedRepairCandidate(solvers[0]!.inputNewHdRoutes)
  const targets = [{
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: "horizontal_0",
    pcb_via_id: "via_0",
    actual_clearance: 0.35,
    minimum_clearance: 0.1,
  }, {
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "horizontal_0",
    pcb_pad_id: "fixed_pad",
    actual_clearance: 7,
    minimum_clearance: 0.1,
  }]
  const retained: Array<{ value: unknown; snapshot: unknown }> = []
  for (let round = 0; round < 20; round++) {
    const input = structuredClone(original)
    for (const point of input[1]!.route) point.x = round / 100
    for (const via of input[1]!.vias) via.x = round / 100
    const originalRoutes = round % 2 === 0 ? original : structuredClone(original)
    const snapshots = [structuredClone(input), structuredClone(originalRoutes)]
    const results = solvers.map((solver) => (solver as unknown as SharedRepairEvaluatorAccess)
      .clearanceMarginDrcEvaluator(input, targets, originalRoutes))
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    expect(input).toEqual(snapshots[0])
    expect(originalRoutes).toEqual(snapshots[1])
    for (const result of results) retained.push({ value: result, snapshot: structuredClone(result) })
  }
  for (const entry of retained) expect(entry.value).toEqual(entry.snapshot)
  expect(solvers[2]!.sharedRepairGeometryStats!.marginEvaluations).toBeGreaterThan(20)
})

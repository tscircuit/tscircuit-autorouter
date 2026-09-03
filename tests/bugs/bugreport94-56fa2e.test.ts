import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { getCurrentCircuitJson } from "lib/testing/autorouting-pipeline-debugger/getCurrentCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import bugReport from "../../fixtures/bug-reports/bugreport94-56fa2e/bugreport94-56fa2e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport94-56fa2e.json with Pipeline 9", () => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
  )
  solver.solve()

  const circuitJson = getCurrentCircuitJson(solver)
  expect(circuitJson).not.toBeNull()
  const { errors } = getDrcErrors(circuitJson!)
  expect(errors.length).toBeLessThanOrEqual(4)
  const targetOverlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_108") &&
      error.pcb_trace_error_id.includes("source_trace_138"),
  )
  expect(targetOverlap).toBeUndefined()
  const transferredOverlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_108"),
  )
  expect(transferredOverlap).toBeUndefined()
  const remainingTargetOverlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_160") &&
      error.pcb_trace_error_id.includes("source_trace_116_mst4"),
  )
  expect(remainingTargetOverlap).toBeUndefined()
  const transferredSource160Overlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_160"),
  )
  expect(transferredSource160Overlap).toBeUndefined()
  const boardEdgeError = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.startsWith("trace_too_close_to_board_"),
  )
  expect(boardEdgeError).toBeUndefined()

  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(repairStats?.regionalB01RepairAttempted).toBe(true)
  expect(repairStats?.regionalB01RepairPreloadEligibleDrcIssueCount).toBe(0)
  expect(Number(repairStats?.regionalB01RepairAcceptedCount)).toBeGreaterThan(0)
  expect(
    Number(repairStats?.regionalB01RepairCandidateSearchCount),
  ).toBeLessThanOrEqual(
    Number(repairStats?.regionalB01RepairCandidateSearchBudget),
  )

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
}, 300_000)

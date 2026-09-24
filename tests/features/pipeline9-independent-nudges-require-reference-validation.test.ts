import { expect, test } from "bun:test"
import { canPublishIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canPublishIndependentClearanceRepairs"

test("partial nudges reject new pairs, worsened gaps, and unproven continuity", (): void => {
  const clearance = {
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: "signal",
    pcb_via_id: "via_1",
    actual_clearance: 0.09,
    minimum_clearance: 0.1,
  }
  const overlap = {
    type: "pcb_trace_error",
    pcb_trace_id: "other",
    pcb_trace_error_id: "overlap_other_pad",
  }
  const before = [clearance, overlap]
  expect(canPublishIndependentClearanceRepairs(before, [overlap])).toBe(true)
  expect(canPublishIndependentClearanceRepairs(before, [clearance])).toBe(true)
  expect(canPublishIndependentClearanceRepairs(before, [
    { ...clearance, actual_clearance: 0.08 },
  ])).toBe(false)
  expect(canPublishIndependentClearanceRepairs(before, [
    { ...clearance, pcb_via_id: "new_via" },
  ])).toBe(false)
  expect(canPublishIndependentClearanceRepairs(before, [
    { type: "pcb_trace_error", pcb_trace_error_id: "missing_connection" },
  ])).toBe(false)
})

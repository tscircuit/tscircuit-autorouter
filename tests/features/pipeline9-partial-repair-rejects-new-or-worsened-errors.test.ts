import { expect, test } from "bun:test"
import { canPublishPartialFixedObstacleRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canPublishPartialFixedObstacleRepair"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/srj18-sample16-partial-repair.json"

test("partial publication rejects new pairs, worsening gaps and unsupported errors", (): void => {
  const clearanceError = {
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "signal_0",
    pcb_pad_id: "pcb_smtpad_62",
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }
  const overlapError = {
    type: "pcb_trace_error",
    pcb_trace_id: "other_0",
    pcb_trace_error_id: "overlap_other_0_pcb_smtpad_168",
  }
  const boardEdgeError = {
    type: "pcb_trace_error",
    pcb_trace_id: "signal_0",
    pcb_trace_error_id: "trace_too_close_to_board_signal_0_segment_0",
    actual_board_edge_clearance: 0.15,
    minimum_board_edge_clearance: 0.2,
  }
  const params = {
    originalSrj: fixture.srj as SimpleRouteJson,
    initialErrors: [clearanceError, overlapError, boardEdgeError],
  }
  expect(
    canPublishPartialFixedObstacleRepair({
      ...params,
      remainingErrors: [clearanceError],
    }),
  ).toBeTrue()
  expect(
    canPublishPartialFixedObstacleRepair({
      ...params,
      remainingErrors: [overlapError, boardEdgeError],
    }),
  ).toBeTrue()
  for (const error of [
    { ...clearanceError, pcb_pad_id: "pcb_smtpad_168" },
    { ...clearanceError, pcb_trace_id: "new_trace_0" },
    { ...clearanceError, actual_clearance: 0.01 },
    { ...clearanceError, actual_clearance: NaN },
    { ...clearanceError, minimum_clearance: 0.2 },
    { ...overlapError, pcb_trace_error_id: "overlap_other_0_pcb_smtpad_62" },
    { ...overlapError, pcb_trace_error_id: "overlap_other_0_via_0" },
    { ...boardEdgeError, actual_board_edge_clearance: 0.1499 },
    { ...boardEdgeError, minimum_board_edge_clearance: 0.1 },
    {
      ...boardEdgeError,
      pcb_trace_error_id: "trace_too_close_to_board_signal_0_segment_1",
    },
    { type: "pcb_trace_error", message: "Missing connection" },
  ]) {
    expect(
      canPublishPartialFixedObstacleRepair({
        ...params,
        remainingErrors: [error],
      }),
    ).toBeFalse()
  }
  expect(
    canPublishPartialFixedObstacleRepair({
      ...params,
      remainingErrors: params.initialErrors,
    }),
  ).toBeFalse()
})

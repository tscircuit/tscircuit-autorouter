import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { isPipeline9JointDrcOutputNoWorse } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9JointDrcOutputNoWorse"

test("Pipeline9 preserves non-copper DRC findings", () => {
  const circuitJson = [
    { type: "pcb_trace", pcb_trace_id: "ordinary" },
    { type: "pcb_smtpad", pcb_smtpad_id: "pad_a" },
    { type: "pcb_smtpad", pcb_smtpad_id: "pad_b" },
  ] as AnyCircuitElement[]
  const padErrors = ["pad_a", "pad_b"].map((padId) => ({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "ordinary",
    pcb_pad_id: padId,
    minimum_clearance: 0.1,
    actual_clearance: 0.02,
  }))
  const missingConnection = {
    type: "pcb_trace_error",
    pcb_trace_id: "ordinary",
    pcb_trace_error_id: "missing_connection_ordinary_terminal_a",
    message: "Trace ordinary is missing a connection to terminal_a",
  }
  const boardEdge = {
    type: "pcb_trace_error",
    pcb_trace_id: "ordinary",
    pcb_trace_error_id: "trace_too_close_to_board_ordinary_segment_0",
    message: "Trace too close to board edge (0.020mm < 0.100mm required)",
    center: { x: 0, y: 1 },
  }
  const unknown = {
    type: "future_drc_error",
    detail: { b: 2, a: 1 },
    identities: ["ordinary", "terminal_a"],
  }
  for (const error of [missingConnection, boardEdge, unknown]) {
    expect(
      isPipeline9JointDrcOutputNoWorse({
        current: { errors: padErrors, circuitJson },
        candidate: { errors: [error], circuitJson },
      }),
    ).toBe(false)
    expect(
      isPipeline9JointDrcOutputNoWorse({
        current: { errors: [error, ...padErrors], circuitJson },
        candidate: { errors: [error], circuitJson },
      }),
    ).toBe(true)
  }
  for (const error of [
    {
      ...missingConnection,
      pcb_trace_error_id: "missing_connection_ordinary_terminal_b",
    },
    {
      ...boardEdge,
      message: "Trace too close to board edge (0.010mm < 0.100mm required)",
    },
    { ...boardEdge, center: { x: 0, y: 2 } },
    { ...unknown, detail: { a: 1, b: 3 } },
  ]) {
    expect(
      isPipeline9JointDrcOutputNoWorse({
        current: {
          errors: [missingConnection, boardEdge, unknown],
          circuitJson,
        },
        candidate: { errors: [error], circuitJson },
      }),
    ).toBe(false)
  }
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [unknown], circuitJson },
      candidate: {
        errors: [
          {
            identities: ["ordinary", "terminal_a"],
            detail: { a: 1, b: 2 },
            type: "future_drc_error",
          },
        ],
        circuitJson,
      },
    }),
  ).toBe(true)
})

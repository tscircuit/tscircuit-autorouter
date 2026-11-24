import { expect, test } from "bun:test"
import { canRetainPipeline9RepairCheckpoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canRetainPipeline9RepairCheckpoint"

type Snapshot = Parameters<typeof canRetainPipeline9RepairCheckpoint>[0]

test("a better repair checkpoint needs complete and non-regressing connectivity evidence", (): void => {
  const baseline: Snapshot = {
    count: 2,
    issueScore: 2,
    errors: [],
    rawErrors: [
      { pcb_trace_error_id: "missing_connection_existing" },
      { pcb_trace_error_id: "other_clearance_error" },
    ],
    traceRouteIndexById: new Map(),
  }
  const candidate: Snapshot = {
    ...baseline,
    count: 1,
    issueScore: 1,
    rawErrors: [{ pcb_trace_error_id: "missing_connection_existing" }],
  }

  expect(canRetainPipeline9RepairCheckpoint(candidate, baseline)).toBe(true)
  expect(
    canRetainPipeline9RepairCheckpoint(
      { ...candidate, rawErrors: undefined },
      baseline,
    ),
  ).toBe(false)
  expect(
    canRetainPipeline9RepairCheckpoint(candidate, {
      ...baseline,
      rawErrors: undefined,
    }),
  ).toBe(false)
  expect(
    canRetainPipeline9RepairCheckpoint(
      {
        ...candidate,
        rawErrors: [{ pcb_trace_error_id: "missing_layer_connection_new" }],
      },
      baseline,
    ),
  ).toBe(false)
  expect(
    canRetainPipeline9RepairCheckpoint(
      {
        ...candidate,
        rawErrors: [
          {
            type: "pcb_trace_error",
            pcb_trace_id: "trace_a",
            pcb_smtpad_id: "pad_b",
            actual_clearance: -0.05,
          },
        ],
      },
      baseline,
    ),
  ).toBe(false)
})

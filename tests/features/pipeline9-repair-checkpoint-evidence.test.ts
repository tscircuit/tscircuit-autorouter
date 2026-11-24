import { expect, test } from "bun:test"
import { canRetainPipeline9RepairCheckpoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canRetainPipeline9RepairCheckpoint"

type Snapshot = Parameters<typeof canRetainPipeline9RepairCheckpoint>[0]

test("a better repair checkpoint needs complete and non-regressing DRC evidence", (): void => {
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
  const baselineSpacingFinding = {
    type: "pcb_via_trace_clearance_error",
    minimum_clearance: 0.15,
    actual_clearance: 0.1,
  }
  const spacingBaseline: Snapshot = {
    ...baseline,
    rawErrors: [baselineSpacingFinding, { type: "unrelated" }],
  }
  expect(
    canRetainPipeline9RepairCheckpoint(
      {
        ...candidate,
        rawErrors: [{ ...baselineSpacingFinding, actual_clearance: 0.12 }],
      },
      spacingBaseline,
    ),
  ).toBe(true)
  expect(
    canRetainPipeline9RepairCheckpoint(
      {
        ...candidate,
        rawErrors: [{ ...baselineSpacingFinding, actual_clearance: 0.04 }],
      },
      spacingBaseline,
    ),
  ).toBe(false)
  expect(
    canRetainPipeline9RepairCheckpoint(
      { ...candidate, issueScore: baseline.issueScore + 1 },
      baseline,
    ),
  ).toBe(false)

  const viaContact = {
    type: "pcb_pad_pad_clearance_error",
    pcb_trace_id: "trace_a",
    pcb_pad_ids: ["via_1", "pad_b"],
    actual_clearance: -0.04,
  }
  const fixedCopperFinding = {
    drc_source: "fixed_copper",
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: "trace_a",
    pcb_via_id: "via_1",
    actual_clearance: -0.02,
  }
  for (const error of [
    { pcb_trace_error_id: "misaligned_via_trace_a_0" },
    { pcb_trace_error_id: "disconnected_endpoint_trace_a_start" },
    { pcb_trace_error_id: "trace_too_close_to_board_trace_a_segment_0" },
    viaContact,
    fixedCopperFinding,
  ]) {
    expect(
      canRetainPipeline9RepairCheckpoint(
        { ...candidate, rawErrors: [error] },
        baseline,
      ),
    ).toBe(false)
  }
  expect(
    canRetainPipeline9RepairCheckpoint(
      {
        ...candidate,
        rawErrors: [{ ...fixedCopperFinding, actual_clearance: -0.05 }],
      },
      {
        ...baseline,
        rawErrors: [fixedCopperFinding, { type: "unrelated" }],
      },
    ),
  ).toBe(false)
  // An unrelated Circuit JSON finding does not mask the fixed-copper finding.
  const existingContinuityFinding = {
    pcb_trace_error_id: "missing_connection_existing",
  }
  const mixedBaseline: Snapshot = {
    ...baseline,
    count: 3,
    rawErrors: [
      existingContinuityFinding,
      { pcb_trace_error_id: "other_clearance_error" },
      { type: "unrelated" },
    ],
  }
  expect(
    canRetainPipeline9RepairCheckpoint(
      {
        ...candidate,
        count: 2,
        rawErrors: [existingContinuityFinding, fixedCopperFinding],
      },
      mixedBaseline,
    ),
  ).toBe(false)
  expect(
    canRetainPipeline9RepairCheckpoint(
      {
        ...candidate,
        count: 2,
        rawErrors: [existingContinuityFinding, existingContinuityFinding],
      },
      mixedBaseline,
    ),
  ).toBe(false)
})

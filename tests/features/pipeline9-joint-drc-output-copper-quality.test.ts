import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { isPipeline9JointDrcOutputNoWorse } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9JointDrcOutputNoWorse"

test("Pipeline9 rejects copper pair replacement and worsening", () => {
  const circuitJson = [
    { type: "pcb_trace", pcb_trace_id: "ordinary" },
    { type: "pcb_trace", pcb_trace_id: "other" },
    { type: "pcb_smtpad", pcb_smtpad_id: "pad_a" },
    { type: "pcb_smtpad", pcb_smtpad_id: "pad_b" },
    { type: "pcb_smtpad", pcb_smtpad_id: "pad_c" },
  ] as AnyCircuitElement[]
  const padError = (
    padId: string,
    actualClearance: number,
  ): Record<string, unknown> => ({
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_trace_clearance_error_id: `pad_trace_clearance_${padId}_ordinary`,
    pcb_trace_id: "ordinary",
    pcb_pad_id: padId,
    minimum_clearance: 0.1,
    actual_clearance: actualClearance,
    center: { x: 0, y: 0 },
  })
  const initial = [padError("pad_a", 0.02), padError("pad_b", 0.04)]
  const comparisons: Array<{
    current: Record<string, unknown>[]
    candidate: Record<string, unknown>[]
    accepted: boolean
  }> = [
    { current: initial, candidate: initial, accepted: true },
    { current: initial, candidate: [], accepted: true },
    {
      current: initial,
      candidate: [padError("pad_c", 0.09)],
      accepted: false,
    },
    {
      current: initial,
      candidate: [padError("pad_a", 0.01)],
      accepted: false,
    },
    {
      current: initial,
      candidate: [padError("pad_a", 0.02 - Number.EPSILON)],
      accepted: false,
    },
    {
      current: initial,
      candidate: [padError("pad_a", 0.09), padError("pad_b", 0.03)],
      accepted: false,
    },
    {
      current: initial,
      candidate: [padError("pad_a", 0.09), padError("pad_a", 0.09)],
      accepted: false,
    },
    {
      current: [padError("pad_a", 0.01), padError("pad_a", 0.08)],
      candidate: [padError("pad_a", 0.07), padError("pad_a", 0.07)],
      accepted: false,
    },
    {
      current: initial,
      candidate: [{ ...padError("pad_a", 0.05), center: { x: 2, y: 3 } }],
      accepted: true,
    },
  ]
  for (const comparison of comparisons) {
    expect(
      isPipeline9JointDrcOutputNoWorse({
        current: { errors: comparison.current, circuitJson },
        candidate: { errors: comparison.candidate, circuitJson },
      }),
    ).toBe(comparison.accepted)
  }

  const contact = {
    type: "pcb_trace_error",
    pcb_trace_id: "ordinary",
    pcb_trace_error_id: "overlap_ordinary_pad_a",
    message:
      'PCB trace ordinary overlaps with pcb_smtpad "pad_a" (accidental contact)',
  }
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [contact], circuitJson },
      candidate: { errors: [padError("pad_a", 0.03)], circuitJson },
    }),
  ).toBe(false)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [contact], circuitJson },
      candidate: { errors: [contact], circuitJson },
    }),
  ).toBe(true)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [contact], circuitJson },
      candidate: { errors: [], circuitJson },
    }),
  ).toBe(true)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [padError("pad_a", 0.03)], circuitJson },
      candidate: { errors: [contact], circuitJson },
    }),
  ).toBe(false)

  const traceContact = {
    type: "pcb_trace_error",
    pcb_trace_id: "ordinary",
    pcb_trace_error_id: "overlap_ordinary_other",
    message: "Traces are too close (gap: 0.020mm)",
  }
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [traceContact], circuitJson },
      candidate: {
        errors: [
          {
            ...traceContact,
            pcb_trace_id: "other",
            pcb_trace_error_id: "overlap_other_ordinary",
            message: "Traces are too close (gap: 0.040mm)",
          },
        ],
        circuitJson,
      },
    }),
  ).toBe(true)
  expect(() =>
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: initial, circuitJson },
      candidate: { errors: [padError("missing_pad", 0.05)], circuitJson },
    }),
  ).toThrow("cannot resolve copper participant")
  expect(() =>
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: initial, circuitJson },
      candidate: { errors: [padError("pad_a", Number.NaN)], circuitJson },
    }),
  ).toThrow("finite clearance measurements")
})

import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { isPipeline9JointDrcOutputNoWorse } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9JointDrcOutputNoWorse"

test("Pipeline9 resolves involved copper using explicit roles", () => {
  const circuitJson = [
    { type: "pcb_trace", pcb_trace_id: "ordinary" },
    { type: "pcb_trace", pcb_trace_id: "via_7" },
    {
      type: "pcb_via",
      pcb_via_id: "via_7",
      pcb_trace_id: "ordinary",
      x: 0,
      y: 0,
      layers: ["top", "bottom"],
    },
    { type: "pcb_via", pcb_via_id: "unrelated_ownerless_via" },
  ] as AnyCircuitElement[]
  const typedViaError = {
    type: "pcb_via_trace_clearance_error",
    pcb_via_trace_clearance_error_id: "via_trace_clearance_via_7_via_7",
    pcb_trace_id: "via_7",
    pcb_via_id: "via_7",
    minimum_clearance: 0.1,
    actual_clearance: 0.02,
  }
  const genericError = {
    type: "pcb_trace_error",
    pcb_trace_id: "ordinary",
    pcb_trace_error_id: "overlap_ordinary_via_7",
    message: "PCB traces are too close (gap: 0.020mm)",
  }
  for (const error of [
    typedViaError,
    { ...genericError, pcb_trace_ids: ["ordinary", "via_7"] },
    { ...genericError, pcb_via_id: "via_7" },
  ]) {
    expect(
      isPipeline9JointDrcOutputNoWorse({
        current: { errors: [error], circuitJson },
        candidate: { errors: [error], circuitJson },
      }),
    ).toBe(true)
  }
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [], circuitJson },
      candidate: { errors: [], circuitJson },
    }),
  ).toBe(true)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [genericError], circuitJson },
      candidate: { errors: [genericError], circuitJson },
    }),
  ).toBe(true)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [genericError], circuitJson },
      candidate: {
        errors: [{ ...genericError, pcb_trace_error_id: "opaque-diagnostic" }],
        circuitJson,
      },
    }),
  ).toBe(false)
  const changedViaContext = circuitJson.map((element) =>
    element.type === "pcb_via" && element.pcb_via_id === "via_7"
      ? { ...element, pcb_trace_id: "via_7", x: 1 }
      : element,
  )
  for (const error of [
    genericError,
    {
      ...genericError,
      pcb_via_id: "via_7",
      message: "PCB trace ordinary overlaps with a via (accidental contact)",
    },
  ]) {
    expect(
      isPipeline9JointDrcOutputNoWorse({
        current: { errors: [error], circuitJson },
        candidate: { errors: [error], circuitJson: changedViaContext },
      }),
    ).toBe(false)
  }
  expect(() =>
    isPipeline9JointDrcOutputNoWorse({
      current: { errors: [typedViaError], circuitJson },
      candidate: {
        errors: [{ ...typedViaError, pcb_via_id: "unrelated_ownerless_via" }],
        circuitJson,
      },
    }),
  ).toThrow("requires a via owner and physical site")
})

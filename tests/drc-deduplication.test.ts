import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("getDrcErrors emits typed pad/via clearance errors without generic duplicates", () => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad1",
      shape: "rect",
      x: 0,
      y: 0.2,
      width: 0.2,
      height: 0.2,
      layer: "top",
    },
    {
      type: "pcb_via",
      pcb_via_id: "via1",
      x: 0.5,
      y: 0.2,
      hole_diameter: 0.2,
      outer_diameter: 0.4,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace1",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]

  const { errors } = getDrcErrors(circuitJson, { traceClearance: 0.1 })

  expect(
    errors.filter((error) => error.type === "pcb_pad_trace_clearance_error"),
  ).toHaveLength(1)
  expect(
    errors.filter((error) => error.type === "pcb_via_trace_clearance_error"),
  ).toHaveLength(1)
  expect(
    errors.filter(
      (error) =>
        error.type === "pcb_trace_error" &&
        (error.pcb_trace_error_id === "overlap_trace1_pad1" ||
          error.pcb_trace_error_id === "overlap_trace1_via1"),
    ),
  ).toHaveLength(0)
})

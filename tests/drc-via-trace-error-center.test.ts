import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("locates via-trace clearance errors at the involved via", () => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_via",
      pcb_via_id: "via_a",
      x: 1,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_b",
      route: [
        { route_type: "wire", x: -10, y: 0.25, width: 0.1, layer: "top" },
        { route_type: "wire", x: 10, y: 0.25, width: 0.1, layer: "top" },
      ],
    },
  ]

  const { errors, errorsWithCenters } = getDrcErrors(circuitJson, {
    traceClearance: 0.1,
    includeTraceContinuity: false,
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    pcb_via_id: "via_a",
    pcb_trace_id: "trace_b",
    center: { x: 1, y: 0 },
  })
  expect(errorsWithCenters[0]?.center).toEqual({ x: 1, y: 0 })
})

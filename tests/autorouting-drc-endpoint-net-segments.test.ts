import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"

test("continuity only accepts nonzero ordinary segments on the endpoint's net", (): void => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "victim",
      source_trace_id: "shared",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "ordinary",
      source_trace_id: "shared",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "zero",
      source_trace_id: "shared",
      route: [
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "interpolated",
      source_trace_id: "shared",
      route_thickness_mode: "interpolated",
      route: [
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "different_net",
      source_trace_id: "other",
      route: [
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 1, width: 0.1, layer: "top" },
      ],
    },
  ]

  const errors = checkTraceContinuity(circuitJson)

  expect(
    errors
      .filter((error) => error.pcb_trace_id === "victim")
      .map((error) => error.pcb_trace_error_id),
  ).toEqual(["disconnected_endpoint_victim_end"])
})

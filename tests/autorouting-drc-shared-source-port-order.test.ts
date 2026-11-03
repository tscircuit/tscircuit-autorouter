import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"

test("shared source traces preserve expected-port order and duplicate membership", (): void => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "source_trace",
      source_trace_id: "source",
      connected_source_port_ids: ["source_b", "source_a", "source_a"],
      connected_source_net_ids: [],
    },
    {
      type: "pcb_port",
      pcb_port_id: "port_a",
      source_port_id: "source_a",
      x: -2,
      y: 1,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "port_b",
      source_port_id: "source_b",
      x: 2,
      y: 1,
      layers: ["top"],
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad_a",
      pcb_port_id: "port_a",
      shape: "rect",
      x: -2,
      y: 1,
      width: 0.2,
      height: 0.2,
      layer: "top",
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad_b",
      pcb_port_id: "port_b",
      shape: "rect",
      x: 2,
      y: 1,
      width: 0.2,
      height: 0.2,
      layer: "top",
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      source_trace_id: "source",
      route: [
        { route_type: "wire", x: -0.1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.1, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_b",
      source_trace_id: "source",
      route: [
        { route_type: "wire", x: -0.1, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.1, y: -1, width: 0.1, layer: "top" },
      ],
    },
  ]

  const errors = checkTraceContinuity(circuitJson)

  expect(errors.map((error) => error.pcb_trace_error_id)).toEqual([
    "missing_connection_trace_a_port_a",
    "missing_connection_trace_a_port_b",
  ])
  expect(errors.map((error) => error.pcb_port_ids)).toEqual([
    ["port_a"],
    ["port_b"],
  ])
})

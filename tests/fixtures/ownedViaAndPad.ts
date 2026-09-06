import type { AnyCircuitElement } from "circuit-json"

export const ownedViaAndPad = (x: number): AnyCircuitElement[] =>
  [
    {
      type: "pcb_port",
      pcb_port_id: "port_a",
      source_port_id: "source_port_a",
      pcb_component_id: "component_a",
      x: 0,
      y: 0,
      layers: ["top"],
    },
    {
      type: "source_trace",
      source_trace_id: "source_trace_a",
      connected_source_port_ids: ["source_port_a"],
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad_a",
      pcb_port_id: "port_a",
      shape: "rect",
      x: 0,
      y: 0,
      width: 0.6,
      height: 0.6,
      layer: "top",
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      source_trace_id: "source_trace_a",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "port_a",
        },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_via",
      pcb_via_id: "via_a",
      pcb_trace_id: "trace_a",
      x,
      y: 0,
      outer_diameter: 0.2,
      hole_diameter: 0.1,
      layers: ["top", "bottom"],
    },
  ] as AnyCircuitElement[]

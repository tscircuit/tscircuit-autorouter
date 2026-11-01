import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

// Reduced reference-DRC reproduction, not the reporter's unavailable board.
// The trace copper clears each foreign pad; only the larger via copper fails.
export const issue3130Input: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaHoleDiameter: 0.3,
  minViaPadDiameter: 0.6,
  minPadEdgeToPadEdgeClearance: 0.2,
  minTraceToPadEdgeClearance: 0.1,
  minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
  bounds: { minX: -1, minY: -1, maxX: 3, maxY: 4.5 },
  obstacles: [0, 3].map((y, index) => ({
    type: "rect",
    center: { x: 0, y },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: [`neighbor_${index}`],
    circuitJsonMetadata: { pcb_smtpad_id: `neighbor_pad_${index}` },
  })),
  connections: [0, 3].map((y, index) => ({
    name: `escape_${index}`,
    pointsToConnect: [
      { x: 2, y, layer: "top", pcb_port_id: `start_${index}` },
      { x: 2, y: y + 1, layer: "bottom", pcb_port_id: `end_${index}` },
    ],
  })),
}

export const issue3130Traces: SimplifiedPcbTrace[] = [0.95, 0.97].map(
  (x, index): SimplifiedPcbTrace => {
    const y = index * 3
    return {
      type: "pcb_trace",
      pcb_trace_id: `trace_escape_${index}`,
      connection_name: `escape_${index}`,
      connectsTo: [`start_${index}`, `end_${index}`],
      route: [
        {
          route_type: "wire",
          x: 2,
          y,
          layer: "top",
          width: 0.1,
          start_pcb_port_id: `start_${index}`,
        },
        { route_type: "wire", x, y, layer: "top", width: 0.1 },
        {
          route_type: "via",
          x,
          y,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.6,
          via_hole_diameter: 0.3,
        },
        { route_type: "wire", x, y, layer: "bottom", width: 0.1 },
        {
          route_type: "wire",
          x: 2,
          y: y + 1,
          layer: "bottom",
          width: 0.1,
          end_pcb_port_id: `end_${index}`,
        },
      ],
    }
  },
)

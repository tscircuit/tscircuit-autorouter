import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

export const copperPourDrcInput: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.2,
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: -2, y: 0 },
      width: 0.5,
      height: 0.5,
      connectedTo: ["ground", "left"],
      circuitJsonMetadata: { pcb_smtpad_id: "left_pad", pcb_port_id: "left" },
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 2, y: 0 },
      width: 0.5,
      height: 0.5,
      connectedTo: ["ground", "right"],
      circuitJsonMetadata: { pcb_smtpad_id: "right_pad", pcb_port_id: "right" },
    },
    {
      type: "rect",
      layers: ["inner1"],
      center: { x: 0, y: 0 },
      width: 8,
      height: 8,
      isCopperPour: true,
      connectedTo: ["ground"],
    },
  ],
  connections: [
    {
      name: "ground",
      pointsToConnect: [
        { x: -2, y: 0, layer: "top", pcb_port_id: "left" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "right" },
      ],
    },
  ],
}

export const copperPourDrcTraces: SimplifiedPcbTrace[] = [
  {
    type: "pcb_trace",
    pcb_trace_id: "left_escape",
    connection_name: "ground",
    route: [
      { route_type: "wire", x: -2, y: 0, width: 0.2, layer: "top", start_pcb_port_id: "left" },
      { route_type: "wire", x: -1, y: 0, width: 0.2, layer: "top" },
      { route_type: "via", x: -1, y: 0, from_layer: "top", to_layer: "inner1" },
      { route_type: "wire", x: -1, y: 0, width: 0.2, layer: "inner1" },
    ],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "right_escape",
    connection_name: "ground",
    route: [
      { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "top", start_pcb_port_id: "right" },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "top" },
      { route_type: "via", x: 1, y: 0, from_layer: "top", to_layer: "inner1" },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "inner1" },
    ],
  },
]

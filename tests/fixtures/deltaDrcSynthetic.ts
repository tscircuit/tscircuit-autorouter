import type { SimpleRouteJson, SimplifiedPcbTrace } from "high-density-repair03/lib/types"

export const deltaDrcSyntheticBoard: SimpleRouteJson = {
  bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
  connections: [
    { name: "a", pointsToConnect: [] },
    { name: "b", pointsToConnect: [] },
    { name: "c", pointsToConnect: [] },
  ],
  obstacles: [
    { type: "rect", layers: ["top"], center: { x: 0.2, y: 0.2 }, width: 0.35, height: 0.6, ccwRotationDegrees: 25, connectedTo: ["pcb_smtpad_foreign"] },
    { type: "rect", layers: ["top", "bottom"], center: { x: -0.4, y: 0.3 }, width: 0.4, height: 0.4, connectedTo: ["pcb_plated_hole_round"] },
    { type: "rect", layers: ["inner1"], center: { x: 0.5, y: 0.1 }, width: 0.2, height: 0.5, connectedTo: ["pcb_smtpad_inner"] },
  ],
  layerCount: 4, minTraceWidth: 0.1, minViaDiameter: 0.3,
}

export const syntheticWire = (id: string, net: string, x: number, y: number): SimplifiedPcbTrace => ({
  type: "pcb_trace", pcb_trace_id: id, connection_name: net,
  route: [
    { route_type: "wire", x: x - 0.4, y, width: 0.1, layer: "top", start_pcb_port_id: `${id}_start` },
    { route_type: "wire", x: x + 0.4, y, width: 0.1, layer: "top", end_pcb_port_id: `${id}_end` },
  ],
})

export const syntheticVia = (id: string, net: string, x: number, y: number): SimplifiedPcbTrace => ({
  type: "pcb_trace", pcb_trace_id: id, connection_name: net,
  route: [
    { route_type: "wire", x: x - 0.3, y, width: 0.1, layer: "top" },
    { route_type: "wire", x, y, width: 0.1, layer: "top" },
    { route_type: "via", x, y, via_diameter: 0.3, from_layer: "top", to_layer: "bottom" },
    { route_type: "wire", x, y, width: 0.1, layer: "bottom" },
    { route_type: "wire", x: x + 0.3, y, width: 0.1, layer: "bottom" },
  ],
})

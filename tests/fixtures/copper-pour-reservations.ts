import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

export const copperPourReservationInput = (): SimpleRouteJson => ({
  layerCount: 4, minTraceWidth: 0.1, minViaDiameter: 0.3,
  minViaPadDiameter: 0.3, minViaHoleDiameter: 0.15,
  allowBlindAndBuriedVias: false,
  bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
  obstacles: [
    ...[-3, 3].map((x, index) => ({
      type: "rect" as const, center: { x, y: 0 }, width: 0.4, height: 0.4,
      layers: ["top"], connectedTo: [`pcb_smtpad_signal_${index}`, `pcb_port_signal_${index}`, "DATA"],
    })),
    { type: "rect", center: { x: 0, y: 0 }, width: 0.6, height: 0.6,
      layers: ["top"], connectedTo: ["pcb_smtpad_ground", "pcb_port_ground", "GROUND"] },
    ...["inner1", "inner2"].map(layer => ({
      type: "rect" as const, center: { x: 0, y: 0 }, width: 8, height: 8,
      layers: [layer], isCopperPour: true, connectedTo: ["GROUND", "ground_alias"],
    })),
  ],
  connections: [{ name: "DATA", pointsToConnect: [
    { x: -3, y: 0, layer: "top", pcb_port_id: "pcb_port_signal_0" },
    { x: 3, y: 0, layer: "top", pcb_port_id: "pcb_port_signal_1" },
  ] }, { name: "GROUND", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_ground" }] }],
})

export const copperPourSignalTrace = (layer: "bottom" | "inner1"): SimplifiedPcbTrace => ({
  type: "pcb_trace", pcb_trace_id: "signal_route", connection_name: "DATA",
  connectsTo: ["pcb_port_signal_0", "pcb_port_signal_1"],
  route: [
    { route_type: "wire", x: -3, y: 0, width: 0.1, layer: "top", start_pcb_port_id: "pcb_port_signal_0" },
    { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
    { route_type: "via", x: -2, y: 0, from_layer: "top", to_layer: layer, via_diameter: 0.3, via_hole_diameter: 0.15, layers: ["top", "inner1", "inner2", "bottom"] },
    { route_type: "wire", x: -2, y: 0, width: 0.1, layer },
    { route_type: "wire", x: 2, y: 0, width: 0.1, layer },
    { route_type: "via", x: 2, y: 0, from_layer: layer, to_layer: "top", via_diameter: 0.3, via_hole_diameter: 0.15, layers: ["top", "inner1", "inner2", "bottom"] },
    { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
    { route_type: "wire", x: 3, y: 0, width: 0.1, layer: "top", end_pcb_port_id: "pcb_port_signal_1" },
  ],
})

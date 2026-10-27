import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

export const createBusLayerInput = (): SimpleRouteJson => ({
  layerCount: 4,
  minTraceWidth: 0.1,
  bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
  obstacles: [],
  connections: [{
    name: "DDR_D0",
    pointsToConnect: [
      { x: -2, y: 0, layer: "top", pointId: "cpu" },
      { x: 2, y: 0, layer: "top", pointId: "ram" },
    ],
  }],
  buses: [{
    busId: "ddr-byte-id",
    name: "DDR byte 0",
    connectionNames: ["DDR_D0"],
    allowedLayers: ["top", "inner2", "bottom"],
  }],
})

export const createBusLayerTrace = (layer: string): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: "ddr-preload",
  connection_name: "DDR_D0",
  connectsTo: ["cpu", "ram"],
  route: [
    { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
    { route_type: "via", x: -2, y: 0, from_layer: "top", to_layer: layer,
      via_diameter: 0.3, layers: ["top", "inner1", "inner2", "bottom"] },
    { route_type: "wire", x: -2, y: 0, layer, width: 0.1 },
    { route_type: "wire", x: 2, y: 0, layer, width: 0.1 },
    { route_type: "via", x: 2, y: 0, from_layer: layer, to_layer: "top",
      via_diameter: 0.3, layers: ["top", "inner1", "inner2", "bottom"] },
    { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
  ],
})

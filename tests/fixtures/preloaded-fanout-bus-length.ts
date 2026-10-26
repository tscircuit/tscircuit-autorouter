import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

export const preloadedFanoutBusLengthInput: SimpleRouteJson = {
  bounds: { minX: -12, maxX: 12, minY: -8, maxY: 8 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaPadDiameter: 0.3,
  minViaHoleDiameter: 0.15,
  minTraceToPadEdgeClearance: 0.1,
  obstacles: [
    { type: "rect", layers: ["top"], center: { x: -5, y: 0 }, width: 0.5, height: 0.5, connectedTo: ["A", "A_CPU"], circuitJsonMetadata: { pcb_port_id: "A_CPU" } },
    { type: "rect", layers: ["top"], center: { x: 5, y: 0 }, width: 0.5, height: 0.5, connectedTo: ["A", "A_DDR"], circuitJsonMetadata: { pcb_port_id: "A_DDR" } },
    { type: "rect", layers: ["top"], center: { x: -5, y: 3 }, width: 0.5, height: 0.5, connectedTo: ["B", "B_CPU"], circuitJsonMetadata: { pcb_port_id: "B_CPU" } },
    { type: "rect", layers: ["top"], center: { x: 5, y: 3 }, width: 0.5, height: 0.5, connectedTo: ["B", "B_DDR"], circuitJsonMetadata: { pcb_port_id: "B_DDR" } },
  ],
  connections: [
    { name: "A", pointsToConnect: [{ x: -5, y: 0, layer: "top", pcb_port_id: "A_CPU" }, { x: 5, y: 0, layer: "top", pcb_port_id: "A_DDR" }] },
    { name: "B", pointsToConnect: [{ x: -5, y: 3, layer: "top", pcb_port_id: "B_CPU" }, { x: 5, y: 3, layer: "top", pcb_port_id: "B_DDR" }] },
  ],
  buses: [{ busId: "DDR_BYTE", connectionNames: ["A", "B"], maxLengthSkew: 0.1 }],
  traces: [{
    type: "pcb_trace",
    pcb_trace_id: "A_CPU_fanout",
    connection_name: "A",
    route: [
      { route_type: "wire", x: -5, y: 0, layer: "top", width: 0.1, start_pcb_port_id: "A_CPU" },
      { route_type: "wire", x: -5, y: -4, layer: "top", width: 0.1 },
      { route_type: "wire", x: -4, y: -4, layer: "top", width: 0.1 },
      { route_type: "wire", x: -4, y: 0, layer: "top", width: 0.1 },
    ],
  }],
}

export const preloadedFanoutBusLengthHdRoutes: HighDensityRoute[] = [
  { connectionName: "A", rootConnectionName: "A", traceThickness: 0.1, viaDiameter: 0.3, endPcbPortId: "A_DDR", route: [{ x: -4, y: 0, z: 0 }, { x: 5, y: 0, z: 0, pcb_port_id: "A_DDR" }], vias: [] },
  { connectionName: "B", rootConnectionName: "B", traceThickness: 0.1, viaDiameter: 0.3, startPcbPortId: "B_CPU", endPcbPortId: "B_DDR", route: [{ x: -5, y: 3, z: 0, pcb_port_id: "B_CPU" }, { x: 5, y: 3, z: 0, pcb_port_id: "B_DDR" }], vias: [] },
]

import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

/** Synthetic cross-layer endpoint alias plus one manufactured via-pad defect. */
export function witnessViaPadRepairFixture(viaY = 0.728): { originalSrj: SimpleRouteJson; pointPairs: SimpleRouteJson; traces: SimplifiedPcbTrace[]; protectedTraces: SimplifiedPcbTrace[] } {
  const originalSrj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.1, minViaDiameter: 0.3, minViaHoleDiameter: 0.15,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    connections: [
      { name: "A", pointsToConnect: [{ x: -2, y: 1, layer: "top", pcb_port_id: "A0" }, { x: 0, y: 0, layer: "bottom", pcb_port_id: "A1" }] },
      { name: "B", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "B0" }, { x: 0, y: -2, layer: "top", pcb_port_id: "B1" }] },
    ],
    obstacles: [
      { type: "rect", center: { x: -2, y: 1 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["A", "A0"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_0", pcb_port_id: "A0" } },
      { type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["bottom"], connectedTo: ["A", "A1"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_1", pcb_port_id: "A1" } },
      { type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1, layers: ["top"], connectedTo: ["B", "B0"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_2", pcb_port_id: "B0" } },
      { type: "rect", center: { x: 0, y: -2 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["B", "B1"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_3", pcb_port_id: "B1" } },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    { type: "pcb_trace", pcb_trace_id: "a", connection_name: "A", connectsTo: ["A0", "A1"], route: [
      { route_type: "wire", x: -2, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: -1, y: 1.5, layer: "top", width: 0.1 },
      { route_type: "via", x: -1, y: 1.5, from_layer: "top", to_layer: "inner1", via_diameter: 0.3, via_hole_diameter: 0.15 },
      { route_type: "wire", x: -1, y: 1.5, layer: "inner1", width: 0.1 },
      { route_type: "wire", x: 0, y: viaY, layer: "inner1", width: 0.1 },
      { route_type: "via", x: 0, y: viaY, from_layer: "inner1", to_layer: "bottom", via_diameter: 0.3, via_hole_diameter: 0.15 },
      { route_type: "wire", x: 0, y: viaY, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 0, y: 0, layer: "bottom", width: 0.1 },
    ] },
    { type: "pcb_trace", pcb_trace_id: "b", connection_name: "B", connectsTo: ["B0", "B1"], route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: -2, layer: "top", width: 0.1 },
    ] },
  ]
  return { originalSrj, pointPairs: structuredClone(originalSrj), traces, protectedTraces: [] }
}

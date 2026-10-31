import type { LayerRef } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

export function scopedClearanceFixture(layer: LayerRef): { srj: SimpleRouteJson; traces: SimplifiedPcbTrace[] } {
  const srj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.2,
    bounds: { minX: -10, minY: -10, maxX: 20, maxY: 20 }, obstacles: [],
    clearanceRules: [
      { name: "EARTH outer", enabled: true, priority: 1, clearance: 4.14,
        scope1: { type: "and", scopes: [{ type: "net", net_ids: ["source_net_earth"] }, { type: "layer", layers: ["top", "bottom"] }] }, scope2: { type: "all" } },
      { name: "EARTH inner", enabled: true, priority: 2, clearance: 1.6,
        scope1: { type: "net", net_ids: ["source_net_earth"] }, scope2: { type: "all" } },
    ],
    connections: ["earth", "signal"].map((net, i) => ({
      name: `opaque_connection_${i}`, sourceNetIds: [`source_net_${net}`],
      pointsToConnect: [{ x: 0, y: i * 2.2, layer }, { x: 10, y: i * 2.2, layer }],
    })),
  }
  const traces: SimplifiedPcbTrace[] = srj.connections.map((connection, i) => ({
    type: "pcb_trace", pcb_trace_id: `trace_${i}`, connection_name: connection.name,
    route: [{ route_type: "wire", x: 0, y: i * 2.2, width: 0.2, layer }, { route_type: "wire", x: 10, y: i * 2.2, width: 0.2, layer }],
  }))
  return { srj, traces }
}

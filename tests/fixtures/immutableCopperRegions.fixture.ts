import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

export const createImmutableCopperRegionsFixture = (): {
  srj: SimpleRouteJson
  graph: SerializedHyperGraph
  netId: string
} => {
  const srj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.1, minViaPadDiameter: 0.3,
    bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 }, obstacles: [],
    connections: [{ name: "A", pointsToConnect: [
      { x: -2, y: 0, layer: "top", pcb_port_id: "A-start" },
      { x: 2, y: 0, layer: "top", pcb_port_id: "A-end" },
    ] }],
    traces: [{ type: "pcb_trace", pcb_trace_id: "certified-A", connection_name: "A", route: [
      { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.2 },
    ] }],
  }
  const netId = getConnectivityMapFromSimpleRouteJson(srj).getNetConnectedToId("A")!
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "center", pointIds: [], d: { center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1, 2, 3] } },
      { regionId: "far", pointIds: [], d: { center: { x: 10, y: 10 }, width: 2, height: 2, availableZ: [0, 1, 2, 3] } },
      { regionId: "bottom-only", pointIds: [], d: { center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [3] } },
    ],
    ports: [],
    connections: [{ connectionId: "A", mutuallyConnectedNetworkId: netId, startRegionId: "center", endRegionId: "far" }],
    solvedRoutes: [],
  }
  return { srj, graph, netId }
}

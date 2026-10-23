import { createElectricalTreeRepairWalks } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export function sharedElectricalTreeClearanceFixture(): {
  connections: SimpleRouteConnection[]
  routes: HighDensityRoute[]
  srj: SimpleRouteJson
  adapter: ReturnType<typeof createElectricalTreeRepairWalks>
} {
  const terminals = [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 1, y: 0, z: 0, pcb_port_id: "B" }, { x: 0, y: 1, z: 1, pcb_port_id: "C" }]
  const connections: SimpleRouteConnection[] = terminals.map((pad, index) => ({
    name: `branch${index}`, rootConnectionName: "bus",
    pointsToConnect: [{ x: pad.x, y: pad.y, layer: pad.z === 0 ? "top" : "bottom", pcb_port_id: pad.pcb_port_id }, { x: 0, y: 0, layer: "top", pointId: "J" }],
    electricalBranch: { netId: "bus", startVertexId: pad.pcb_port_id, endVertexId: "J", logicalConnectionNames: ["bus"] },
  }))
  const routes: HighDensityRoute[] = terminals.map((pad, index) => ({ connectionName: `branch${index}`, rootConnectionName: "bus", traceThickness: 0.1, viaDiameter: 0.2,
    startPcbPortId: pad.pcb_port_id,
    route: index === 2 ? [pad, { x: 0, y: 0.5, z: 1 }, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }] : [pad, { x: 0, y: 0, z: 0 }],
    vias: index === 2 ? [{ x: 0, y: 0.5 }] : [],
  }))
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections,
    obstacles: [{ type: "rect", center: { x: 0, y: -0.15 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign"] }] }
  return { connections, routes, srj, adapter: createElectricalTreeRepairWalks({ connections, routes, layerCount: 2 }) }
}

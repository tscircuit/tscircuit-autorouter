import { expect, test } from "bun:test"
import { PolyHypergraphPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/PolyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

test("octagonal pathing reserves shared pads for their canonical electrical network", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [{ type: "rect", center: { x: 1, y: 5 }, width: 0.6, height: 0.6,
      layers: ["top"], connectedTo: ["a", "b", "shared-port"] }],
    connections: [
      { name: "a", pointsToConnect: [
        { x: 1, y: 5, layer: "top", pcb_port_id: "shared-port" },
        { x: 9, y: 9, layer: "top" },
      ] },
      { name: "b", pointsToConnect: [
        { x: 1, y: 5, layer: "top", pcb_port_id: "shared-port" },
        { x: 9, y: 1, layer: "top" },
      ] },
    ],
  }
  const solver = new PolyHypergraphPortPointPathingSolver({ srj, regionShape: "octagonal" })
  solver.solve()
  expect(solver.solved).toBe(true)
  const graph = solver.serializedGraph
  expect(graph.connections[0]!.mutuallyConnectedNetworkId).toBe(
    graph.connections[1]!.mutuallyConnectedNetworkId)
  for (const name of ["a", "b"]) {
    const terminal = graph.ports.find((port) => port.portId === `terminal-start-port-${name}`)!
    expect(terminal.region1Id).toBe("connected-obstacle-0")
    expect(terminal.d.z).toBe(0)
  }
})

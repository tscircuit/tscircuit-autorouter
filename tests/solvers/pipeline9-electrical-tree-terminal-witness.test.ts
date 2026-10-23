import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { createElectricalTreeTerminalWitnesses } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeTerminalWitnesses"

test("terminal witnesses copy only source-certified nonpreloaded terminals", (): void => {
  const connection = {
    connectionId: "C-B",
    startRegionId: "start",
    endRegionId: "end",
    mutuallyConnectedNetworkId: "bus",
    simpleRouteConnection: {
      name: "C-B",
      pointsToConnect: [
        { x: 40, y: 20, layer: "top", pcb_port_id: "C" },
        { x: 30, y: 0, layer: "top", pcb_port_id: "B" },
      ],
    },
  }
  const graph: SerializedHyperGraph = {
    regions: [],
    ports: connection.simpleRouteConnection.pointsToConnect.map((point, index) => ({
      portId: `original-${index}`,
      region1Id: index === 0 ? "start" : "end",
      region2Id: "real-region",
      d: { _tinyTerminal: true, pcb_port_id: point.pcb_port_id, x: point.x, y: point.y, z: 0 },
    })),
    connections: [connection],
    solvedRoutes: [{
      connection,
      requiredRip: false,
      path: [0, 1].map((index) => ({
        portId: `original-${index}`,
        g: 0, h: 0, f: 0, hops: 0, ripRequired: false,
      })),
    }],
  }
  const witnesses = createElectricalTreeTerminalWitnesses(graph, 2)
  expect(witnesses.size).toBe(2)
  const original = { ...witnesses.get("original-0")! }
  graph.ports[0]!.d.x = 41
  expect(witnesses.get("original-0")).toEqual(original)
  expect(() => createElectricalTreeTerminalWitnesses(graph, 2))
    .toThrow("cannot certify original terminal")
  graph.ports[0]!.d.x = 40
  for (const mutation of [
    { pcb_port_id: "unknown" },
    { pcb_port_id: "" },
    { x: Number.NaN },
    { y: 20.001 },
    { z: 1 },
  ]) {
    const invalid = structuredClone(graph)
    Object.assign(invalid.ports[0]!.d, mutation)
    expect(() => createElectricalTreeTerminalWitnesses(invalid, 2))
      .toThrow("cannot certify original terminal")
  }
  const preloaded = structuredClone(graph)
  Object.assign(preloaded.connections![0]!, {
    preloadedTraceSection: {
      traceId: "preloaded",
      startRoutePosition: 0,
      endRoutePosition: 1,
      startPoint: { x: 40, y: 20, z: 0 },
      endPoint: { x: 30, y: 0, z: 0 },
    },
  })
  expect(createElectricalTreeTerminalWitnesses(preloaded, 2).size).toBe(0)
})

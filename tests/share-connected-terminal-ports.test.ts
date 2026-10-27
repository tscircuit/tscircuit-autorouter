import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { shareConnectedTerminalPorts, type TerminalPortIdentity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/shareConnectedTerminalPorts"

test("shares terminal ports only with matching physical identity, net, region, layer and geometry", () => {
  const base: TerminalPortIdentity = {
    portId: "p0", terminalRegionId: "t0", physicalTerminalId: "pcb-port:pad1",
    netId: "net1", hostRegionId: "host", z: 0, x: 1, y: 2,
  }
  const identities: TerminalPortIdentity[] = [
    base,
    { ...base, portId: "p1", terminalRegionId: "t1" },
    { ...base, portId: "p2", terminalRegionId: "t2", netId: "net2" },
    { ...base, portId: "p3", terminalRegionId: "t3", z: 1 },
    { ...base, portId: "p4", terminalRegionId: "t4", hostRegionId: "other" },
    { ...base, portId: "p5", terminalRegionId: "t5", x: 3 },
    { ...base, portId: "p6", terminalRegionId: "t6", physicalTerminalId: undefined },
    { ...base, portId: "p7", terminalRegionId: "t7", physicalTerminalId: "pcb-port:pad2" },
  ]
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "host", d: {}, pointIds: identities.filter((terminal) => terminal.hostRegionId === "host").map((terminal) => terminal.portId) },
      { regionId: "other", d: {}, pointIds: ["p4"] },
      ...identities.map((terminal) => ({ regionId: terminal.terminalRegionId, d: {}, pointIds: [terminal.portId] })),
    ],
    ports: identities.map((terminal) => ({
      portId: terminal.portId, region1Id: terminal.hostRegionId, region2Id: terminal.terminalRegionId,
      d: { x: terminal.x, y: terminal.y, z: terminal.z },
    })),
    connections: [],
  }
  shareConnectedTerminalPorts({ graph, terminals: identities })
  expect(graph.ports.map((port) => port.portId)).toEqual(["p0", "p2", "p3", "p4", "p5", "p6", "p7"])
  expect(graph.regions.some((region) => region.regionId === "t1")).toBe(false)
  expect(graph.regions[0]!.pointIds).toEqual(["p0", "p2", "p3", "p5", "p6", "p7"])
})

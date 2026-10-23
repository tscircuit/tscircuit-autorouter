import { expect, test } from "bun:test"
import { compileSharedElectricalTrees } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/compileSharedElectricalTrees"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types"

test("cycle removal projects actual demand ownership and widths onto the retained tree and removes unused stubs", (): void => {
  const point = (id: string, x: number, y: number, owner: string, terminal?: string): PortPoint => ({
    portPointId: id, electricalVertexId: id, electricalTerminalId: terminal, connectionName: owner,
    rootConnectionName: "bus", x, y, z: 0, ...(terminal ? { pcb_port_id: terminal } : {}),
  })
  const a = point("A", 0, 0, "ab", "A"), j = point("J", 1, 0, "ab"), b = point("B", 2, 0, "ab", "B")
  const c = point("C", 1, 2, "cb", "C"), cj = { ...j, connectionName: "cb" }, d = point("D", 5, 0, "cb"), cb = { ...b, connectionName: "cb" }
  const pairs: Array<[PortPoint, PortPoint]> = [[a, j], [j, b], [c, cj], [cj, d], [d, cb]]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "cell", center: { x: 2.5, y: 1 }, width: 6, height: 4,
    portPoints: pairs.flat(), portPointsInPairs: pairs, availableZ: [0] }
  const connections: SimpleRouteConnection[] = [
    { name: "ab", nominalTraceWidth: 0.1, pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 2, y: 0, layer: "top", pcb_port_id: "B" }] },
    { name: "cb", nominalTraceWidth: 0.3, pointsToConnect: [{ x: 1, y: 2, layer: "top", pcb_port_id: "C" }, { x: 2, y: 0, layer: "top", pcb_port_id: "B" }] },
  ]
  const output = compileSharedElectricalTrees({ nodes: [node], connections,
    netByConnection: new Map([["ab", "bus"], ["cb", "bus"]]), excludedConnections: new Set(),
    demandEndpoints: new Map<string, readonly [string, string]>([["ab", ["A", "B"]], ["cb", ["C", "B"]]]), layerCount: 2 })
  expect(output.stats.electricalTreeRemovedCycleEdgeCount).toBe(1)
  expect(output.stats.electricalTreeRemovedUnownedEdgeCount).toBe(1)
  expect(output.stats.electricalTreeVerifiedDemandCount).toBe(2)
  expect(output.edges).toHaveLength(3)
  const edgeOwners = (from: string, to: string): string[] => output.edges.find((edge) =>
    [edge.from, edge.to].sort().join(":") === [from, to].sort().join(":"))!.owners
  expect(edgeOwners("A", "J")).toEqual(["ab"])
  expect(edgeOwners("J", "B")).toEqual(["ab", "cb"])
  expect(edgeOwners("C", "J")).toEqual(["cb"])
  const widths = output.connections.map((connection) => ({ vertices: [connection.electricalBranch!.startVertexId, connection.electricalBranch!.endVertexId].sort().join(":"), width: connection.nominalTraceWidth }))
  expect(widths.find((entry) => entry.vertices === "A:J")!.width).toBe(0.1)
  expect(widths.find((entry) => entry.vertices === "B:J")!.width).toBe(0.3)
  expect(widths.find((entry) => entry.vertices === "C:J")!.width).toBe(0.3)
  expect(output.nodesWithPortPoints.flatMap((entry) => entry.portPoints).some((entry) => entry.electricalVertexId === "D")).toBe(false)
})

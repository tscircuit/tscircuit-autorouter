import { expect, test } from "bun:test"
import { compileSharedElectricalTrees } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/compileSharedElectricalTrees"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types"

test("shared copper has one physical edge, explicit owner references and complete original demand proofs", (): void => {
  const point = (id: string, x: number, y: number, owner: string, terminal?: string): PortPoint => ({
    portPointId: id, electricalVertexId: id, electricalTerminalId: terminal,
    connectionName: owner, rootConnectionName: "bus", x, y, z: 0,
    ...(terminal ? { pcb_port_id: terminal } : {}),
  })
  const ab = [point("A", 0, 0, "ab", "A"), point("J", 1, 0, "ab"), point("B", 2, 0, "ab", "B")]
  const cb = [point("C", 1, 1, "cb", "C"), point("J", 1, 0, "cb"), point("B", 2, 0, "cb", "B")]
  const pairs: Array<[PortPoint, PortPoint]> = [[ab[0]!, ab[1]!], [ab[1]!, ab[2]!], [cb[0]!, cb[1]!], [cb[1]!, cb[2]!]]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "cell", center: { x: 1, y: 0.5 }, width: 3, height: 3,
    portPoints: pairs.flat(), portPointsInPairs: pairs, availableZ: [0] }
  const connections: SimpleRouteConnection[] = [
    { name: "ab", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 2, y: 0, layer: "top", pcb_port_id: "B" }] },
    { name: "cb", pointsToConnect: [{ x: 1, y: 1, layer: "top", pcb_port_id: "C" }, { x: 2, y: 0, layer: "top", pcb_port_id: "B" }] },
  ]
  const input = { nodes: [node], connections, netByConnection: new Map([["ab", "bus"], ["cb", "bus"]]),
    excludedConnections: new Set<string>(), demandEndpoints: new Map<string, readonly [string, string]>([["ab", ["A", "B"]], ["cb", ["C", "B"]]]), layerCount: 2 }
  const result = compileSharedElectricalTrees(input)
  expect(result.stats).toMatchObject({ electricalTreeLogicalEdgeReferenceCount: 4, electricalTreeSharedEdgeCount: 1,
    electricalTreePhysicalEdgeCount: 3, electricalTreePhysicalBranchCount: 3, electricalTreeVerifiedDemandCount: 2, electricalTreeJunctionCount: 1 })
  expect(result.nodesWithPortPoints.flatMap((entry) => entry.portPointsInPairs ?? [])).toHaveLength(3)
  expect(result.edges.find((edge) => [edge.from, edge.to].sort().join(":") === "B:J")!.owners.sort()).toEqual(["ab", "cb"])
  expect(new Set(result.connections.map((connection) => connection.name)).size).toBe(3)
  expect(result.connections.every((connection) => connection.electricalBranch !== undefined)).toBe(true)
  const terminalIds = result.connections.flatMap((connection) => connection.pointsToConnect).flatMap((endpoint) => endpoint.pcb_port_id ? [endpoint.pcb_port_id] : [])
  expect(terminalIds.sort()).toEqual(["A", "B", "C"])
  expect(() => compileSharedElectricalTrees({ ...input, demandEndpoints: new Map([["ab", ["A", "missing"] as const], ["cb", ["C", "B"] as const]]) }))
    .toThrow("cannot resolve terminal")
  const cycled = structuredClone(node)
  cycled.portPointsInPairs!.push([ab[0]!, ab[2]!])
  cycled.portPoints = cycled.portPointsInPairs!.flat()
  expect(compileSharedElectricalTrees({ ...input, nodes: [cycled] }).stats.electricalTreeRemovedCycleEdgeCount).toBe(1)
})

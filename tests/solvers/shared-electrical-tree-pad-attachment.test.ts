import { expect, test } from "bun:test"
import { certifyElectricalTreePadAttachment } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/certifyElectricalTreePadAttachment"
import { compileSharedElectricalTrees } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/compileSharedElectricalTrees"
import { getDeclaredTerminalStitchRoutes } from "lib/solvers/RouteStitchingSolver/getDeclaredTerminalStitchRoutes"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteConnection } from "lib/types"

test("a roundoff-separated attachment uses a real pad conductor witness without losing logical demands", (): void => {
  const point = (id: string, x: number, y: number, owner: string, terminal?: string): PortPoint => ({
    portPointId: id, electricalVertexId: id, electricalTerminalId: terminal,
    connectionName: owner, rootConnectionName: "bus", x, y, z: 0,
    ...(terminal ? { pcb_port_id: terminal } : {}),
  })
  const a = point("A", 0, 0, "ab", "A"), j = point("J", 0, Number.EPSILON, "ab")
  const b = point("B", 2, 0, "ab", "B"), c = point("C", 0, 2, "cb", "C")
  const cj = { ...j, connectionName: "cb" }, cb = { ...b, connectionName: "cb" }
  const pairs: Array<[PortPoint, PortPoint]> = [[a, j], [j, b], [c, cj], [cj, cb]]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "cell", center: { x: 1, y: 1 }, width: 4, height: 4,
    portPoints: pairs.flat(), portPointsInPairs: pairs, availableZ: [0] }
  const connections: SimpleRouteConnection[] = [
    { name: "ab", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 2, y: 0, layer: "top", pcb_port_id: "B" }] },
    { name: "cb", pointsToConnect: [{ x: 0, y: 2, layer: "top", pcb_port_id: "C" }, { x: 2, y: 0, layer: "top", pcb_port_id: "B" }] },
  ]
  const pad: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.3,
    ccwRotationDegrees: 37, layers: ["top"], connectedTo: ["A"] }
  const input = { nodes: [node], connections, netByConnection: new Map([["ab", "bus"], ["cb", "bus"]]),
    excludedConnections: new Set<string>(), demandEndpoints: new Map<string, readonly [string, string]>([["ab", ["A", "B"]], ["cb", ["C", "B"]]]), layerCount: 2, obstacles: [pad] }
  const output = compileSharedElectricalTrees(input)
  expect(output.stats.electricalTreeVerifiedDemandCount).toBe(2)
  expect(output.stats.electricalTreeCertifiedPadAttachmentCount).toBe(1)
  expect(output.stats.electricalTreePhysicalEdgeCount).toBe(2)
  expect(output.padAttachmentWitnesses).toEqual([{ netId: "bus", attachmentVertexId: "J", padVertexId: "A", obstacleIndex: 0 }])
  expect(output.connections.flatMap((connection) => connection.pointsToConnect)
    .filter((endpoint) => endpoint.pcb_port_id === "A").every((endpoint) => endpoint.x === 0 && endpoint.y === 0)).toBe(true)
  expect(node.portPoints.find((entry) => entry.electricalVertexId === "J")!.y).toBe(Number.EPSILON)
  expect(compileSharedElectricalTrees({ ...input, obstacles: [] }).stats.electricalTreePhysicalEdgeCount).toBe(3)
  expect(() => getDeclaredTerminalStitchRoutes({ connections: compileSharedElectricalTrees({ ...input, obstacles: [] }).connections,
    hdRoutes: [], layerCount: 2 })).toThrow("has no copper")
  for (const obstacle of [{ ...pad, connectedTo: ["foreign"] }, { ...pad, layers: ["bottom"] },
    { ...pad, isNonPlatedHole: true }, { ...pad, isCopperPour: true },
    { ...pad, center: { x: 1, y: 1 } }, { ...pad, __zLayers: [Number.NaN] }]) {
    expect(certifyElectricalTreePadAttachment({ terminal: a, attachment: j, obstacles: [obstacle], layerCount: 2 })).toBeUndefined()
  }
  for (const attachment of [{ ...j, z: 1 }, { ...j, x: 1e-7 }, { ...j, x: Number.NaN }, { ...j, electricalTerminalId: "other-pad" }]) {
    expect(certifyElectricalTreePadAttachment({ terminal: a, attachment, obstacles: [pad], layerCount: 2 })).toBeUndefined()
  }
  expect(certifyElectricalTreePadAttachment({ terminal: a, attachment: j, obstacles: [{ ...pad, shape: "circle" }], layerCount: 2 })).toBe(0)
  const excluded = compileSharedElectricalTrees({ ...input, excludedConnections: new Set(["ab"]) })
  expect(excluded.padAttachmentWitnesses).toEqual([])
  expect(excluded.nodesWithPortPoints.flatMap((entry) => entry.portPointsInPairs ?? []).filter((pair) => pair[0].connectionName === "ab"))
    .toEqual(pairs.filter((pair) => pair[0].connectionName === "ab"))
  const x = point("X", 0, 0, "xf", "X"), f = point("F", 2, 2, "xf", "F")
  const foreignPairs: Array<[PortPoint, PortPoint]> = [...pairs, [x, { ...j, connectionName: "xf" }], [{ ...j, connectionName: "xf" }, f]]
  const separateNet = compileSharedElectricalTrees({ ...input,
    nodes: [{ ...node, portPoints: foreignPairs.flat(), portPointsInPairs: foreignPairs }],
    connections: [...connections, { name: "xf", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "X" }, { x: 2, y: 2, layer: "top", pcb_port_id: "F" }] }],
    netByConnection: new Map([...input.netByConnection, ["xf", "foreign"]]),
    demandEndpoints: new Map([...input.demandEndpoints, ["xf", ["X", "F"] as const]]),
  })
  expect(separateNet.padAttachmentWitnesses).toEqual(output.padAttachmentWitnesses)
  expect(separateNet.nodesWithPortPoints.flatMap((entry) => entry.portPoints)
    .some((entry) => entry.connectionName === "xf" && entry.electricalVertexId === "J")).toBe(true)
  expect(separateNet.connections.find((connection) => connection.electricalBranch!.netId === "foreign")!.pointsToConnect)
    .toMatchObject([{ pcb_port_id: "F" }, { pcb_port_id: "X" }])
  const d = point("D", Number.EPSILON, 0, "db", "D")
  const ambiguousPairs: Array<[PortPoint, PortPoint]> = [...pairs, [d, { ...j, connectionName: "db" }]]
  const ambiguous = compileSharedElectricalTrees({ ...input,
    nodes: [{ ...node, portPoints: ambiguousPairs.flat(), portPointsInPairs: ambiguousPairs }],
    connections: [...connections, { name: "db", pointsToConnect: [{ x: d.x, y: d.y, layer: "top", pcb_port_id: "D" }, { x: 2, y: 0, layer: "top", pcb_port_id: "B" }] }],
    netByConnection: new Map([...input.netByConnection, ["db", "bus"]]),
    demandEndpoints: new Map([...input.demandEndpoints, ["db", ["D", "B"] as const]]),
    obstacles: [{ ...pad, connectedTo: ["A", "D"] }],
  })
  expect(ambiguous.padAttachmentWitnesses).toEqual([])
  expect(ambiguous.connections.flatMap((connection) => connection.pointsToConnect).find((endpoint) => endpoint.pcb_port_id === "D"))
    .toMatchObject({ x: Number.EPSILON, y: 0 })
  expect(() => getDeclaredTerminalStitchRoutes({ connections: ambiguous.connections, hdRoutes: [], layerCount: 2 }))
    .toThrow("has no copper")
})

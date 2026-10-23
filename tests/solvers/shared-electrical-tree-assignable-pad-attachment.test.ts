import { expect, test } from "bun:test"
import { certifyElectricalTreePadAttachment, type ElectricalTreePadSourceTerminal } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/certifyElectricalTreePadAttachment"
import { compileSharedElectricalTrees } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/compileSharedElectricalTrees"
import { getDeclaredTerminalStitchRoutes } from "lib/solvers/RouteStitchingSolver/getDeclaredTerminalStitchRoutes"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteConnection } from "lib/types"

test("a source-bound assignable physical pad certifies only its exact roundoff attachment", (): void => {
  // Exact geometry and identity of the original T113 pcb_port_211 failure.
  const a: PortPoint = { connectionName: "ab", rootConnectionName: "ground", portPointId: "A",
    electricalVertexId: "A", electricalTerminalId: "pcb_port_211", pcb_port_id: "pcb_port_211",
    x: 4.186659442026, y: -19.7, z: 3 }
  const j: PortPoint = { connectionName: "ab", rootConnectionName: "ground", portPointId: "J",
    electricalVertexId: "J", x: a.x, y: -19.700000000000003, z: 3 }
  const b: PortPoint = { ...a, portPointId: "B", electricalVertexId: "B", electricalTerminalId: "pcb_port_217",
    pcb_port_id: "pcb_port_217", y: -22.1 }
  const c: PortPoint = { ...a, connectionName: "ac", portPointId: "C", electricalVertexId: "C",
    electricalTerminalId: "pcb_port_288", pcb_port_id: "pcb_port_288", x: 4.8, y: -19.479884, z: 0 }
  const pad: Obstacle = { type: "rect", center: { x: a.x, y: a.y }, width: 1.3, height: 0.2,
    layers: ["bottom"], connectedTo: ["pcb_smtpad_211", "pcb_port_211", "ground"], netIsAssignable: true,
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_211", pcb_port_id: "pcb_port_211", source_port_name: "VSS1" } }
  const source: ElectricalTreePadSourceTerminal = { netId: "ground", sourceConnectionName: "ab", sourceEndpointIndex: 0,
    point: { x: a.x, y: a.y, layer: "bottom", pointId: "pcb_port_211", pcb_port_id: "pcb_port_211" } }
  const common = { terminal: a, attachment: j, obstacles: [pad], layerCount: 4, netId: "ground", sourceTerminal: source }
  expect(certifyElectricalTreePadAttachment(common)).toBe(0)
  expect(certifyElectricalTreePadAttachment({ ...common, sourceTerminal: {
    ...source, point: { x: a.x, y: a.y, layers: ["top", "bottom"], pcb_port_id: "pcb_port_211" },
  } })).toBe(0)
  for (const obstacle of [
    { ...pad, circuitJsonMetadata: undefined },
    { ...pad, circuitJsonMetadata: { pcb_port_id: "pcb_port_211" } },
    { ...pad, circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_211", pcb_port_id: "foreign" } },
    { ...pad, circuitJsonMetadata: { pcb_smtpad_id: "forged-unconnected-pad", pcb_port_id: "pcb_port_211" } },
    { ...pad, circuitJsonMetadata: { pcb_smtpad_id: "", pcb_port_id: "pcb_port_211" } },
    { ...pad, circuitJsonMetadata: { ...pad.circuitJsonMetadata, pcb_plated_hole_id: "ambiguous" } },
    { ...pad, circuitJsonMetadata: { ...pad.circuitJsonMetadata, pcb_via_id: "not-a-pad" } },
    { ...pad, connectedTo: ["foreign"] },
    { ...pad, layers: ["top"] },
    { ...pad, isCopperPour: true },
    { ...pad, center: { x: a.x + 2, y: a.y } },
  ]) expect(certifyElectricalTreePadAttachment({ ...common, obstacles: [obstacle] })).toBeUndefined()
  for (const change of [
    { sourceTerminal: undefined },
    { netId: "foreign" },
    { sourceTerminal: { ...source, netId: "foreign" } },
    { sourceTerminal: { ...source, sourceConnectionName: "" } },
    { sourceTerminal: { ...source, point: { ...source.point, pcb_port_id: "foreign" } } },
    { sourceTerminal: { ...source, point: { x: a.x, y: a.y, layer: "top", pcb_port_id: "pcb_port_211" } } },
    { sourceTerminal: { ...source, point: { ...source.point, y: j.y } } },
    { attachment: { ...j, x: j.x + 1e-7 } },
    { attachment: { ...j, z: 0 } },
  ]) expect(certifyElectricalTreePadAttachment({ ...common, ...change })).toBeUndefined()
  const acA = { ...a, connectionName: "ac" }, acJ = { ...j, connectionName: "ac" }
  const pairs: Array<[PortPoint, PortPoint]> = [[a, j], [j, b], [acA, acJ], [acJ, c]]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "actual-pad-attachment", center: { x: 4.4, y: -20.8 },
    width: 4, height: 4, availableZ: [0, 3], portPoints: pairs.flat(), portPointsInPairs: pairs }
  const connections: SimpleRouteConnection[] = [
    { name: "ab", pointsToConnect: [source.point, { x: b.x, y: b.y, layer: "bottom", pcb_port_id: b.pcb_port_id }] },
    { name: "ac", pointsToConnect: [source.point, { x: c.x, y: c.y, layer: "top", pcb_port_id: c.pcb_port_id }] },
  ]
  const input = { nodes: [node], connections, netByConnection: new Map([["ab", "ground"], ["ac", "ground"]]),
    excludedConnections: new Set<string>(), demandEndpoints: new Map<string, readonly [string, string]>([["ab", ["A", "B"]], ["ac", ["A", "C"]]]),
    layerCount: 4, obstacles: [pad] }
  const output = compileSharedElectricalTrees(input)
  expect(output.stats.electricalTreeVerifiedDemandCount).toBe(2)
  expect(output.stats.electricalTreeCertifiedPadAttachmentCount).toBe(1)
  expect(output.stats.electricalTreePhysicalEdgeCount).toBe(2)
  expect(output.padAttachmentWitnesses).toEqual([{ netId: "ground", attachmentVertexId: "J", padVertexId: "A", obstacleIndex: 0 }])
  expect(output.nodesWithPortPoints.flatMap((entry) => entry.portPoints).some((point) => point.electricalVertexId === "J")).toBe(false)
  expect(output.connections.flatMap((connection) => connection.pointsToConnect)
    .filter((point) => point.pcb_port_id === "pcb_port_211").every((point) => point.x === a.x && point.y === a.y)).toBe(true)
  expect(node.portPoints.find((point) => point.electricalVertexId === "J")!.y).toBe(j.y)
  const generic = compileSharedElectricalTrees({ ...input, obstacles: [{ ...pad, circuitJsonMetadata: undefined }] })
  expect(generic.stats.electricalTreeCertifiedPadAttachmentCount).toBe(0)
  expect(generic.stats.electricalTreePhysicalEdgeCount).toBe(3)
  expect(() => getDeclaredTerminalStitchRoutes({ connections: generic.connections, hdRoutes: [], layerCount: 4 })).toThrow("has no copper")
})

import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("contacts multilayer PCB terminals on the routed layer without synthetic vias", () => {
  const params = structuredClone(input) as any
  params.layerCount = 2
  params.preserveTerminalPcbPortIds = true
  params.flags.ENABLE_CONNECTED_TERMINAL_LAYER_CHOICES = true
  const visit = (value: any): void => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value.availableZ)) value.availableZ = [0, 1]
    if (typeof value.z === "number") value.z = 1
    for (const child of Object.values(value)) visit(child)
  }
  visit(params.graph)
  for (const connection of params.connections) {
    visit(connection.startRegion)
    visit(connection.endRegion)
    connection.simpleRouteConnection.pointsToConnect.forEach(
      (point: any, i: number) => {
        delete point.layer
        point.layers = ["top", "bottom"]
        point.pcb_port_id = i === 0 ? "pcb_port_start" : "pcb_port_end"
      },
    )
  }
  const firstPoint =
    params.connections[0].simpleRouteConnection.pointsToConnect[0]
  delete firstPoint.layers
  firstPoint.layer = "top"
  params.terminalLayerIndicesByPcbPortId = new Map([
    ["pcb_port_start", new Set([0, 1])],
  ])
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  const nodes = solver.getOutput().nodesWithPortPoints
  expect(
    nodes.every((node) => node.portPoints.every((point) => point.z === 1)),
  ).toBe(true)
  expect(
    nodes
      .flatMap((node) => node.portPoints)
      .filter((point) => point.pcb_port_id)
      .map(({ x, y, z, pcb_port_id }) => ({ x, y, z, pcb_port_id }))
      .sort((a, b) => a.x - b.x),
  ).toEqual([
    { x: -4, y: -3, z: 1, pcb_port_id: "pcb_port_start" },
    { x: 4, y: -3, z: 1, pcb_port_id: "pcb_port_end" },
  ])
  expect(
    nodes.every(
      (node) => !node.capacityMeshNodeId.startsWith("tiny-terminal:"),
    ),
  ).toBe(true)
})

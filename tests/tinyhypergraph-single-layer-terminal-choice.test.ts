import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("keeps a single-layer PCB terminal fixed when its corridor uses another layer", () => {
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
        point.layer = i === 0 ? "top" : "bottom"
        point.pcb_port_id = i === 0 ? "pcb_port_start" : "pcb_port_end"
      },
    )
  }
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  const nodes = solver.getOutput().nodesWithPortPoints
  const terminalPoints = nodes
    .flatMap((node) => node.portPoints)
    .filter((point) => point.pcb_port_id)
    .sort((a, b) => a.x - b.x)
  expect(
    terminalPoints.map(({ z, pcb_port_id }) => ({ z, pcb_port_id })),
  ).toEqual([
    { z: 0, pcb_port_id: "pcb_port_start" },
    { z: 1, pcb_port_id: "pcb_port_end" },
  ])
  expect(
    nodes
      .flatMap((node) => node.portPointsInPairs ?? [])
      .filter(([a, b]) => a.z !== b.z),
  ).toHaveLength(1)
})

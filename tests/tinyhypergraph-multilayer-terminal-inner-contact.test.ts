import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("chooses only declared pad layers on a four-layer board through section routing", () => {
  const params = structuredClone(input) as any
  params.layerCount = 4
  params.preserveTerminalPcbPortIds = true
  params.flags.ENABLE_CONNECTED_TERMINAL_LAYER_CHOICES = true
  const visit = (value: any): void => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value.availableZ)) value.availableZ = [0, 1, 2, 3]
    if (typeof value.z === "number") value.z = 2
    for (const child of Object.values(value)) visit(child)
  }
  visit(params.graph)
  for (const connection of params.connections) {
    visit(connection.startRegion)
    visit(connection.endRegion)
    connection.simpleRouteConnection.pointsToConnect.forEach(
      (point: any, i: number) => {
        delete point.layer
        point.layers = ["top", "inner2"]
        point.pcb_port_id = i === 0 ? "pcb_port_start" : "pcb_port_end"
      },
    )
  }
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  const points = solver
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
  expect(points.every((point) => point.z === 2)).toBe(true)
  expect(points.filter((point) => point.pcb_port_id).map(({ z }) => z)).toEqual(
    [2, 2],
  )
})

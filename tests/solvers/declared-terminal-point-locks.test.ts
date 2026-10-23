import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("declared stitch completion binds exact pad identities to point locks and rejects conflicting PCB metadata", (): void => {
  const connection = { name: "ab", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top", pcb_port_id: "B" }],
    electricalBranch: { netId: "ab", startVertexId: "A", endVertexId: "B", logicalConnectionNames: ["ab"] } }
  const route: HighDensityRoute = { connectionName: "ab", rootConnectionName: "ab", traceThickness: 0.1, viaDiameter: 0.3,
    startPcbPortId: "A", endPcbPortId: "B", route: [{ x: 0, y: 0, z: 0 }, { x: 1 - Number.EPSILON, y: 0, z: 0 }], vias: [] }
  const solver = new MultipleHighDensityRouteStitchSolver3({ connections: [connection], hdRoutes: [route], layerCount: 2,
    preserveTerminalPcbPortIds: true, useDeclaredConnectionEndpoints: true })
  solver.solve()
  expect(solver.solved).toBe(true)
  const output = solver.mergedHdRoutes[0]!
  expect(output.route[0]).toEqual({ x: 0, y: 0, z: 0, pcb_port_id: "A" })
  expect(output.route.at(-1)).toEqual({ x: 1, y: 0, z: 0, pcb_port_id: "B" })
  expect(output.startPcbPortId).toBe("A")
  expect(output.endPcbPortId).toBe("B")
  expect(() => assertSharedElectricalTreeRoutes({ connections: [connection], routes: [output], layerCount: 2 })).not.toThrow()
  const conflicting = new MultipleHighDensityRouteStitchSolver3({ connections: [connection],
    hdRoutes: [{ ...route, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0, pcb_port_id: "foreign" }] }],
    layerCount: 2, preserveTerminalPcbPortIds: true, useDeclaredConnectionEndpoints: true })
  expect(() => conflicting.solve()).toThrow("conflicting PCB terminal")
  const moved = structuredClone(output)
  moved.route[0]!.x = 0.01
  expect(() => assertSharedElectricalTreeRoutes({ connections: [connection], routes: [moved], layerCount: 2 })).toThrow("moved physical pad")
})

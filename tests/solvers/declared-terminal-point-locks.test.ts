import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("declared stitching binds exact pad point locks including a roundoff-length terminal lead", (): void => {
  const connection = { name: "ab", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top", pcb_port_id: "B" }] }
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
  const conflicting = new MultipleHighDensityRouteStitchSolver3({ connections: [connection],
    hdRoutes: [{ ...route, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0, pcb_port_id: "foreign" }] }],
    layerCount: 2, preserveTerminalPcbPortIds: true, useDeclaredConnectionEndpoints: true })
  expect(() => conflicting.solve()).toThrow("conflicting PCB terminal")
})

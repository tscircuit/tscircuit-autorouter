import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("removing an exact repeated fragment keeps a plated terminal's already routed inner layer", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "plated_signal", rootConnectionName: "plated_root",
    startPcbPortId: "plated_start", endPcbPortId: "plated_end",
    traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 2 }, { x: 4, y: 0, z: 2 }],
    vias: [],
  }
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [{ name: "plated_signal", pointsToConnect: [
      { x: 0, y: 0, layers: ["top", "inner1", "inner2", "bottom"], pcb_port_id: "plated_start" },
      { x: 4, y: 0, layers: ["top", "inner1", "inner2", "bottom"], pcb_port_id: "plated_end" },
    ] }],
    hdRoutes: [route, structuredClone(route)], layerCount: 4,
    preserveTerminalPcbPortIds: true, preferSameLayerTerminalEndpoints: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]!.route).toEqual(route.route)
  expect(solver.mergedHdRoutes[0]!.vias).toEqual([])
  expect(solver.mergedHdRoutes[0]!.startPcbPortId).toBe("plated_start")
  expect(solver.mergedHdRoutes[0]!.endPcbPortId).toBe("plated_end")
})

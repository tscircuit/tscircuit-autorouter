import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("opposite-layer terminals keep their identities when their XY positions coincide", (): void => {
  const common = { connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3 }
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: 0, y: 0, layer: "bottom", pcb_port_id: "bottom" },
        { x: 0.0004, y: 0, layer: "top", pcb_port_id: "top" },
      ],
    }],
    hdRoutes: [
      { ...common, startPcbPortId: "bottom", route: [{ x: 0.00005, y: 0, z: 7 }, { x: 0.00005, y: -0.6, z: 7 }], vias: [] },
      { ...common, route: [{ x: 0.00005, y: -0.6, z: 7 }, { x: 0.00005, y: -0.6, z: 0 }], vias: [{ x: 0.00005, y: -0.6 }] },
      { ...common, endPcbPortId: "top", route: [{ x: 0.00005, y: -0.6, z: 0 }, { x: 0.00005, y: 0, z: 0 }], vias: [] },
    ],
    layerCount: 8,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  expect({
    [route.startPcbPortId!]: route.route[0]!.z,
    [route.endPcbPortId!]: route.route.at(-1)!.z,
  }).toEqual({ bottom: 7, top: 0 })
})

import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("stacked terminal islands retain two distinct physical pad identities", (): void => {
  const connectionName = "stacked-pads"
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [{ name: connectionName, pointsToConnect: [
      { x: -0.0000551, y: 0.00007222, layer: "bottom", pcb_port_id: "bottom-pad" },
      { x: 0.00040972, y: 0.00007222, layer: "top", pcb_port_id: "top-pad" },
    ] }],
    hdRoutes: [
      { connectionName, traceThickness: 0.1, viaDiameter: 0.3, vias: [],
        startPcbPortId: "bottom-pad", route: [{ x: 0, y: 0, z: 7 }, { x: 0, y: 0.6, z: 7 }] },
      { connectionName, traceThickness: 0.1, viaDiameter: 0.3, vias: [{ x: 0, y: 0.6 }],
        route: [{ x: 0, y: 0.6, z: 7 }, { x: 0, y: 0.6, z: 0 }] },
      { connectionName, traceThickness: 0.1, viaDiameter: 0.3, vias: [],
        endPcbPortId: "top-pad", route: [{ x: 0, y: 0.6, z: 0 }, { x: 0, y: 0, z: 0 }] },
    ],
    layerCount: 8,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  expect(new Set([route.startPcbPortId, route.endPcbPortId])).toEqual(new Set(["bottom-pad", "top-pad"]))
  expect(new Set([route.route[0]!.z, route.route.at(-1)!.z])).toEqual(new Set([0, 7]))
})

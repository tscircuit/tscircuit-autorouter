import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("stitching avoids a dangling via branch and reaches its declared terminal", (): void => {
  const fragment = (
    points: HighDensityRoute["route"],
    endpoints: Partial<HighDensityRoute> = {},
  ): HighDensityRoute => ({
    connectionName: "signal",
    rootConnectionName: "signal",
    route: points,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    ...endpoints,
  })
  const routes = [
    fragment([{ x: 0, y: 0, z: 1 }, { x: 0.2, y: 0, z: 1 }], {
      startPcbPortId: "a",
    }),
    fragment([{ x: 0, y: 1.4, z: 1 }, { x: 0.4, y: 0.8, z: 1 }], {
      startPcbPortId: "b",
    }),
    fragment([
      { x: 0.4, y: 0.8, z: 1 },
      { x: 0.4, y: 0.8, z: 0 },
      { x: 0.6, y: 0.8, z: 0 },
    ], { vias: [{ x: 0.4, y: 0.8 }] }),
    fragment([{ x: 0.6, y: 0.8, z: 0 }, { x: 0.8, y: 0, z: 0 }]),
    fragment([{ x: 0.8, y: 0, z: 0 }, { x: 0.8, y: 0, z: 2 }], {
      vias: [{ x: 0.8, y: 0 }],
    }),
    fragment([{ x: 0.1, y: 0.45, z: 1 }, { x: 0.55, y: 0.45, z: 1 }], {
      connectionName: "barrier",
      rootConnectionName: "barrier",
    }),
  ]
  const solver = new MultipleHighDensityRouteStitchSolver3({
    layerCount: 3,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
    connections: [
      { name: "signal", pointsToConnect: [
        { x: 0, y: 0, layer: "inner1", pcb_port_id: "a" },
        { x: 0, y: 1.4, layer: "inner1", pcb_port_id: "b" },
      ] },
      { name: "barrier", pointsToConnect: [
        { x: 0.1, y: 0.45, layer: "inner1" },
        { x: 0.55, y: 0.45, layer: "inner1" },
      ] },
    ],
    hdRoutes: routes,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const stitched = solver.mergedHdRoutes.find(
    (route): boolean => route.connectionName === "signal",
  )!
  const terminalY = stitched.route.map((point) => point.y)
  expect([terminalY[0], terminalY.at(-1)].sort()).toEqual([0, 1.4])
  expect(stitched.route[0]!.z).toBe(1)
  expect(stitched.route.at(-1)!.z).toBe(1)
  expect(stitched.vias).toEqual([])
})

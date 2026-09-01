import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("trace simplification preserves endpoints for duplicate connection names", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "shared-connection",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "shared-connection",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 2, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
      ],
      vias: [],
    },
  ]
  const solver = new TraceSimplificationSolver({
    hdRoutes: routes,
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
    preserveRouteEndpoints: true,
    iterations: 1,
    runFinalViaRemovalPass: true,
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.simplificationPipelineLoops).toBe(1)
  expect(solver.finalViaRemovalPassCompleted).toBeTrue()
  expect(
    solver.simplifiedHdRoutes.map((route) => [
      route.route[0],
      route.route.at(-1),
    ]),
  ).toEqual(routes.map((route) => [route.route[0], route.route.at(-1)]))
})

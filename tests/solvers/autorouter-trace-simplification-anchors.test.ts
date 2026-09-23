import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutorouterTraceSimplificationSolver } from "lib/solvers/AutorouterTraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("autorouter cleanup keeps required vias, splice endpoints and immutable copper", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.6,
    viaDiameter: 0.8,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 3, y: 1, z: 1 },
      { x: 4, y: 1, z: 1 },
      { x: 5, y: 0, z: 1 },
      { x: 6, y: 0, z: 1 },
      { x: 6, y: 0, z: 0 },
      { x: 8, y: 0, z: 0 },
    ],
    vias: [{ x: 2, y: 0 }, { x: 6, y: 0 }],
  }
  const immutableRoute: HighDensityRoute = {
    connectionName: "barrier",
    traceThickness: 0.6,
    viaDiameter: 0.8,
    route: [{ x: 4, y: -3, z: 0 }, { x: 4, y: 3, z: 0 }],
    vias: [],
  }
  const originalImmutableRoute = structuredClone(immutableRoute)
  const solver = new AutorouterTraceSimplificationSolver({
    hdRoutes: [route],
    otherHdRoutes: [immutableRoute],
    obstacles: [],
    outline: [{ x: -1, y: -3 }, { x: 9, y: -3 }, { x: 9, y: 3 }, { x: -1, y: 3 }],
    connMap: new ConnectivityMap({
      signal_net: ["signal"],
      barrier_net: ["barrier"],
    }),
    colorMap: {},
    defaultViaDiameter: 0.8,
    layerCount: 2,
    enableCrossingViaReduction: true,
    preserveRouteEndpoints: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.simplifiedHdRoutes).toHaveLength(1)
  const simplifiedRoute = solver.simplifiedHdRoutes[0]!
  expect(simplifiedRoute.vias).toHaveLength(2)
  expect(simplifiedRoute.route[0]).toEqual(route.route[0])
  expect(simplifiedRoute.route.at(-1)).toEqual(route.route.at(-1))
  expect(simplifiedRoute.traceThickness).toBe(0.6)
  expect(simplifiedRoute.route.length).toBeLessThan(route.route.length)
  expect(immutableRoute).toEqual(originalImmutableRoute)
})

import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("optimizing one route keeps other routes with the same name in collision checks", (): void => {
  const firstRoute: HighDensityRoute = {
    connectionName: "shared_net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 10, y: 0, z: 0 },
      { x: 11, y: 0, z: 0 },
    ],
    vias: [],
  }
  const blockingRoute: HighDensityRoute = {
    ...firstRoute,
    route: [
      { x: 2, y: -1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ],
  }
  const routeWithVias: HighDensityRoute = {
    connectionName: "other_net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const solver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: [firstRoute, routeWithVias, blockingRoute],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    layerCount: 2,
    preserveRouteEndpoints: true,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.getOptimizedHdRoutes()?.[1]?.vias).toEqual(routeWithVias.vias)
})

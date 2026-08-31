import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

test("keeps a route with an unsupported layer transition immutable", () => {
  const routes = createCrossingViaReductionRoutes()
  routes[0]!.route.push({ x: 2, y: -6, z: 1 })
  const initialRoutes = structuredClone(routes)
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: routes,
    obstacles: [],
    connMap: new ConnectivityMap({
      detour_net: ["detour"],
      transition_net: ["transition"],
    }),
    layerCount: 2,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getReducedHdRoutes()).toEqual(initialRoutes)
  expect(solver.stats.routesSkippedForUnsupportedLayerTransitions).toBe(1)
})

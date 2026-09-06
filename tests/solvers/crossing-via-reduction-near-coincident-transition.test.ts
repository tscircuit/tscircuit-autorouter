import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

test("preserves an existing via across a near-coincident layer transition", () => {
  const routes = createCrossingViaReductionRoutes()
  routes[0]!.route.unshift(
    { x: -4, y: 3, z: 1 },
    { x: -3.9999998, y: 3, z: 0 },
  )
  routes[0]!.vias.unshift({ x: -4, y: 3 })
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: routes,
    obstacles: [],
    connMap: new ConnectivityMap({
      detour_net: ["detour"],
      transition_net: ["transition"],
    }),
    layerCount: 2,
  })

  expect(() => solver.solve()).not.toThrow()
  expect(solver.failed).toBe(false)
  expect(solver.stats.viasRemovedByCrossingReductions).toBe(2)
  expect(solver.getReducedHdRoutes()[0]!.vias).toContainEqual({
    x: -4,
    y: 3,
  })
})

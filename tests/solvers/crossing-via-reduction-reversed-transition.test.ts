import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

test("reduces the crossing when the transition route is reversed", () => {
  const routes = createCrossingViaReductionRoutes()
  routes[1]!.route.reverse()
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

  const [detour, transition] = solver.getReducedHdRoutes()
  expect(solver.failed).toBe(false)
  expect(solver.stats.viasRemovedByCrossingReductions).toBe(2)
  expect(detour!.vias).toHaveLength(0)
  expect(transition!.vias).toHaveLength(1)
  expect(transition!.vias[0]!.x).toBeLessThan(-2)
  expect(transition!.route[0]).toMatchObject({ x: -3, y: 0, z: 0 })
  expect(transition!.route.at(-1)).toMatchObject({ x: 0, y: 4, z: 1 })
})

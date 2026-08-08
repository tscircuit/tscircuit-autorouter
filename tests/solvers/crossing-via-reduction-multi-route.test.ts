import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import {
  createMultiRouteCrossing,
  createSameRouteMultiSectionCrossing,
} from "tests/fixtures/crossing-via-reduction-multi-crossing-routes"

test("atomically relocates multiple crossing vias to remove one detour", () => {
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: createMultiRouteCrossing(),
    obstacles: [],
    connMap: new ConnectivityMap({
      detour_net: ["detour"],
      transition_a_net: ["transition-a"],
      transition_b_net: ["transition-b"],
    }),
    layerCount: 2,
  })

  solver.solve()

  const routes = solver.getReducedHdRoutes()
  expect(solver.failed).toBe(false)
  expect(solver.stats.crossingViaReductions).toBe(1)
  expect(solver.stats.multiCrossingReductions).toBe(1)
  expect(solver.stats.transitionRoutesMovedByMultiCrossingReductions).toBe(2)
  expect(routes.flatMap((route) => route.vias)).toHaveLength(2)
  expect(routes[0].vias).toHaveLength(0)
  expect(routes[0].route.every((point) => point.z === 0)).toBe(true)
  expect(routes[1].vias[0]!.x).toBeLessThan(-2)
  expect(routes[2].vias[0]!.x).toBeLessThan(-2)
})

test("relocates multiple sections of one crossing route atomically", () => {
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: createSameRouteMultiSectionCrossing(),
    obstacles: [],
    connMap: new ConnectivityMap({
      detour_net: ["detour"],
      transition_net: ["transition"],
    }),
    layerCount: 2,
  })

  solver.solve()

  const routes = solver.getReducedHdRoutes()
  expect(solver.failed).toBe(false)
  expect(solver.stats.crossingViaReductions).toBe(1)
  expect(solver.stats.multiCrossingReductions).toBe(1)
  expect(solver.stats.transitionRoutesMovedByMultiCrossingReductions).toBe(1)
  expect(routes.flatMap((route) => route.vias)).toHaveLength(3)
  expect(routes[0].vias).toHaveLength(0)
  expect(routes[1].vias).toHaveLength(3)
})

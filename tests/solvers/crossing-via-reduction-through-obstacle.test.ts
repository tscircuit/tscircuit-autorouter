import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

test("preserves a marked through-obstacle layer transition", () => {
  const routes = createCrossingViaReductionRoutes()
  routes[1]!.route.unshift({
    x: 1,
    y: 5,
    z: 0,
    toNextSegmentType: "through_obstacle",
  })
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
  expect(detour!.vias).toHaveLength(0)
  expect(transition!.vias).toHaveLength(1)
  expect(transition!.route[0]).toMatchObject({
    x: 1,
    y: 5,
    z: 0,
    toNextSegmentType: "through_obstacle",
  })
  expect(transition!.route[1]).toMatchObject({ x: 0, y: 4, z: 1 })
})

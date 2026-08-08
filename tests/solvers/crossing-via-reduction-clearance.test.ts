import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import type { Obstacle } from "lib/types"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

test("keeps the three-via crossing when the relocated via is blocked", () => {
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["bottom"],
    __zLayers: [1],
    center: { x: -2.375, y: 0 },
    width: 0.2,
    height: 0.2,
    connectedTo: ["blocked_net"],
  }
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: createCrossingViaReductionRoutes(),
    obstacles: [obstacle],
    connMap: new ConnectivityMap({
      detour_net: ["detour"],
      transition_net: ["transition"],
      blocked_net: ["blocked_net"],
    }),
    layerCount: 2,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.crossingViaReductions).toBeUndefined()
  expect(solver.getReducedHdRoutes().flatMap((route) => route.vias)).toEqual([
    { x: -2, y: 3 },
    { x: -1, y: -3 },
    { x: 0, y: 0 },
  ])
})

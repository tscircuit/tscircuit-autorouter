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

test("ignores pre-existing obstacle clearance on unchanged geometry", () => {
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: { x: -2.5, y: 3 },
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
  expect(solver.stats.crossingViaReductions).toBe(1)
  expect(solver.stats.viasRemovedByCrossingReductions).toBe(2)
})

test("checks changed geometry against static obstacles", () => {
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: { x: -2, y: 1 },
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
})

test("checks unchanged geometry against the modified partner route", () => {
  const routes = createCrossingViaReductionRoutes()
  const detour = routes[0]
  detour.route.unshift(
    { x: -1, y: 0, z: 1, pcb_port_id: "detour-prefix" },
    { x: -1.5, y: 0, z: 1 },
    { x: -1.5, y: 0, z: 0, insideJumperPad: true },
  )
  detour.vias.unshift({ x: -1.5, y: 0 })

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
  expect(solver.stats.crossingViaReductions).toBeUndefined()
  expect(solver.getReducedHdRoutes().flatMap((route) => route.vias)).toEqual([
    { x: -1.5, y: 0 },
    { x: -2, y: 3 },
    { x: -1, y: -3 },
    { x: 0, y: 0 },
  ])
})

import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("later shortcuts are checked against earlier optimized routes", () => {
  const firstRoute: HighDensityRoute = {
    connectionName: "first_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 3, y: 1, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const secondRoute: HighDensityRoute = {
    connectionName: "second_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 2, y: -2, z: 0 },
      { x: 2, y: -1, z: 0 },
      { x: 2, y: -1, z: 1 },
      { x: 4, y: -1, z: 1 },
      { x: 4, y: 1, z: 1 },
      { x: 2, y: 1, z: 1 },
      { x: 2, y: 1, z: 0 },
      { x: 2, y: 2, z: 0 },
    ],
    vias: [
      { x: 2, y: -1 },
      { x: 2, y: 1 },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 2, y: 1 },
      width: 1,
      height: 0.5,
      connectedTo: ["other_net"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 4, y: 0 },
      width: 0.5,
      height: 1,
      connectedTo: ["other_net"],
    },
  ]
  const solver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: [firstRoute, secondRoute],
    obstacles,
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: [firstRoute.connectionName],
      net1: [secondRoute.connectionName],
    }),
  })

  solver.solve()

  const routes = solver.getOptimizedHdRoutes()
  expect(routes?.[0].vias).toHaveLength(0)
  expect(routes?.[1].vias).toHaveLength(2)
})

import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ViaPairReroutingSolver } from "lib/solvers/ViaPairReroutingSolver/ViaPairReroutingSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("keeps vias when the reroute is longer than their configured distance cost", () => {
  const route: HighDensityRoute = {
    connectionName: "route-to-simplify",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
  }
  const blocker: HighDensityRoute = {
    connectionName: "blocking-route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 2, y: -1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ],
    vias: [],
  }
  const solver = new ViaPairReroutingSolver({
    hdRoutes: [route, blocker],
    obstacles: [],
    connMap: new ConnectivityMap({
      netA: [route.connectionName],
      netB: [blocker.connectionName],
    }),
    layerCount: 2,
    defaultViaDiameter: 0.3,
    viaDistanceCost: 0,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.optimizedHdRoutes[0]).toEqual(route)
})

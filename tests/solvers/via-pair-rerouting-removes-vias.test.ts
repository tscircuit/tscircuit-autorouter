import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ViaPairReroutingSolver } from "lib/solvers/ViaPairReroutingSolver/ViaPairReroutingSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const routeWithViaPair: HighDensityRoute = {
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

const crossingRoute: HighDensityRoute = {
  connectionName: "route-to-preserve",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 2, y: -1, z: 0 },
    { x: 2, y: 1, z: 0 },
  ],
  vias: [],
}

test("reroutes between vias on one layer and leaves other routes unchanged", () => {
  const originalCrossingRoute = structuredClone(crossingRoute)
  const solver = new ViaPairReroutingSolver({
    hdRoutes: [routeWithViaPair, crossingRoute],
    obstacles: [],
    connMap: new ConnectivityMap({
      netA: [routeWithViaPair.connectionName],
      netB: [crossingRoute.connectionName],
    }),
    layerCount: 2,
    defaultViaDiameter: 0.3,
  })

  solver.solve()

  const [rerouted, preserved] = solver.optimizedHdRoutes
  expect(solver.failed).toBe(false)
  expect(solver.viaDistanceCost).toBe(20)
  expect(rerouted.vias).toHaveLength(0)
  expect(rerouted.route.every((point) => point.z === 0)).toBe(true)
  expect(rerouted.route.some((point) => Math.abs(point.y) > 1)).toBe(true)
  expect(preserved).toEqual(originalCrossingRoute)
})

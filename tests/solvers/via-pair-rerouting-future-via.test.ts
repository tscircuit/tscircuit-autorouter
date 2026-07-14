import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ViaPairReroutingSolver } from "lib/solvers/ViaPairReroutingSolver/ViaPairReroutingSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const routeWithNonAdjacentReturn: HighDensityRoute = {
  connectionName: "route-to-simplify",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
    { x: 2, y: 0, z: 2 },
    { x: 4, y: 0, z: 2 },
    { x: 4, y: 0, z: 0 },
  ],
  vias: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 4, y: 0 },
  ],
}

test("reroutes to a non-adjacent future via returning to the same layer", () => {
  const solver = new ViaPairReroutingSolver({
    hdRoutes: [routeWithNonAdjacentReturn],
    obstacles: [],
    connMap: new ConnectivityMap({
      netA: [routeWithNonAdjacentReturn.connectionName],
    }),
    layerCount: 3,
    defaultViaDiameter: 0.3,
  })

  solver.solve()

  const [rerouted] = solver.optimizedHdRoutes
  expect(solver.failed).toBe(false)
  expect(rerouted.vias).toHaveLength(0)
  expect(rerouted.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ])
})

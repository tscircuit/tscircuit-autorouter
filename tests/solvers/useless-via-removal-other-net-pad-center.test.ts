import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("via removal cannot move a route vertex onto another net's pad center", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const solver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: [route],
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["other_net"],
      },
    ],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    layerCount: 2,
    preserveRouteEndpoints: true,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.getOptimizedHdRoutes()?.[0]?.vias).toEqual(route.vias)
})

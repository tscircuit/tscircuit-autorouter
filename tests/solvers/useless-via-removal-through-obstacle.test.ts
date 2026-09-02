import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("via removal preserves a plated-hole transition without adding a via", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 1, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
    ],
    vias: [],
  }
  const solver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: [route],
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top", "bottom"],
        connectedTo: ["signal"],
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
  const optimizedRoute = solver.getOptimizedHdRoutes()?.[0]
  expect(optimizedRoute?.route).toEqual(route.route)
  expect(optimizedRoute?.vias).toEqual([])
})

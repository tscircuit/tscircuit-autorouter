import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("does not recreate a via for a through-obstacle layer transition", () => {
  const route: HighDensityRoute = {
    connectionName: "through-obstacle-route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -0.2, y: -2.9, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 0.2, y: -2.9, z: 1 },
      { x: 1, y: -2.9, z: 1 },
    ],
    vias: [],
  }
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
  })

  solver.solve()

  const optimizedRoute = solver.getOptimizedHdRoute()
  expect(solver.failed).toBe(false)
  expect(optimizedRoute.vias).toEqual([])
  expect(optimizedRoute.route).toEqual(route.route)
})

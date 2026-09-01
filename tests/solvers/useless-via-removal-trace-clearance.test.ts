import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("keeps vias when moving a section would violate trace clearance", (): void => {
  const route: HighDensityRoute = {
    connectionName: "route_with_vias",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const nearbyRoute: HighDensityRoute = {
    connectionName: "nearby_route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 1, y: 0.243, z: 0 },
      { x: 3, y: 0.243, z: 0 },
    ],
    vias: [],
  }
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route, nearbyRoute]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({
      net0: [route.connectionName],
      net1: [nearbyRoute.connectionName],
    }),
    traceMargin: 0.1,
  })

  solver.solve()

  const optimizedRoute = solver.getOptimizedHdRoute()
  expect(optimizedRoute.vias).toEqual(route.vias)
  expect(optimizedRoute.route).toEqual(route.route)
})

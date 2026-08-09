import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("bounds obstacle detour validation after ranked candidates keep failing", () => {
  const route: HighDensityRoute = {
    connectionName: "detour_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ],
  }
  const blockingRoute: HighDensityRoute = {
    connectionName: "blocking_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -2, z: 0 },
      { x: 0, y: 2, z: 0 },
    ],
    vias: [],
  }
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route, blockingRoute]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({
      detour_net: [route.connectionName],
      blocking_net: [blockingRoute.connectionName],
    }),
    enableGeometryShortcuts: true,
    enableObstacleDetourShortcuts: true,
  })
  const instrumentedSolver = solver as unknown as {
    getObstacleDetourPaths: () => Array<{
      path: HighDensityRoute["route"]
      length: number
    }>
  }
  instrumentedSolver.getObstacleDetourPaths = () =>
    Array.from({ length: 1_000 }, () => ({
      path: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      length: 2,
    }))

  solver.solve()

  expect(solver.getOptimizedHdRoute().vias).toEqual(route.vias)
  expect(solver.stats.obstacleDetourCandidatesValidated).toBe(256)
})

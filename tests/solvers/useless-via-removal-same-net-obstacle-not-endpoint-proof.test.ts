import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("same-net sibling obstacles do not prove endpoint layer support", () => {
  const route: HighDensityRoute = {
    connectionName: "route-a",
    rootConnectionName: "route-a",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ],
    vias: [{ x: 1, y: 0 }],
  }
  const sameNetSiblingObstacle: Obstacle = {
    type: "rect",
    layers: ["bottom"],
    zLayers: [1],
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: ["route-b"],
  }

  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", [
      sameNetSiblingObstacle,
    ]),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: ["route-a", "route-b"] }),
  })

  solver.solve()

  const optimizedRoute = solver.getOptimizedHdRoute()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(optimizedRoute.vias).toEqual([{ x: 1, y: 0 }])
  expect(optimizedRoute.route).toEqual(route.route)
})

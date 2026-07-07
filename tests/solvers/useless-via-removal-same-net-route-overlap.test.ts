import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("removes useless vias when the moved section overlaps a same-net sibling route", () => {
  const routeWithUselessVias: HighDensityRoute = {
    connectionName: "route-a",
    rootConnectionName: "route-a",
    traceThickness: 0.15,
    viaDiameter: 0.45,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.2, y: 0, z: 0 },
      { x: 0.2, y: 0, z: 1 },
      { x: 0.2, y: 0.6, z: 1 },
      { x: 0.2, y: 0.6, z: 0 },
      { x: 0.4, y: 0.6, z: 0 },
    ],
    vias: [
      { x: 0.2, y: 0 },
      { x: 0.2, y: 0.6 },
    ],
  }
  const sameNetSiblingRoute: HighDensityRoute = {
    connectionName: "route-b",
    rootConnectionName: "route-b",
    traceThickness: 0.15,
    viaDiameter: 0.45,
    route: [
      { x: 0, y: 0.3, z: 0 },
      { x: 0.4, y: 0.3, z: 0 },
    ],
    vias: [],
  }

  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([
      routeWithUselessVias,
      sameNetSiblingRoute,
    ]),
    unsimplifiedRoute: structuredClone(routeWithUselessVias),
    connMap: new ConnectivityMap({ net0: ["route-a", "route-b"] }),
  })

  solver.solve()

  const optimizedRoute = solver.getOptimizedHdRoute()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(optimizedRoute.vias).toEqual([])
  expect(optimizedRoute.route.every((point) => point.z === 0)).toBe(true)
})

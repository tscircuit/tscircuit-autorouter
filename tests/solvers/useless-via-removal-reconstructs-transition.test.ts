import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("reconstructs a physical transition after collapsing a layer section", () => {
  const route: HighDensityRoute = {
    connectionName: "multilayer_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 0, z: 2 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  }
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
  })

  solver.solve()

  const optimizedRoute = solver.getOptimizedHdRoute()
  const via = optimizedRoute.vias[0]
  if (!via) throw new Error("Expected one physical via")
  expect(via).toEqual({ x: 1, y: 0 })
  expect(
    optimizedRoute.route.some(
      (point, index, points) =>
        point.x === via.x &&
        point.y === via.y &&
        points[index + 1]?.x === via.x &&
        points[index + 1]?.y === via.y &&
        point.z !== points[index + 1]?.z,
    ),
  ).toBe(true)
})

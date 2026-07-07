import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("throws when endpoint layer support is unproven", () => {
  const route: HighDensityRoute = {
    connectionName: "source_net_test",
    rootConnectionName: "source_net_test",
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
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
  })

  expect(() => solver.solve()).toThrow(
    'UselessViaRemovalSolver could not find endpoint obstacle for route "source_net_test" at (0, 0)',
  )
  expect(solver.failed).toBe(true)
})

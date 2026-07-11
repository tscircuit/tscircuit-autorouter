import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("does not move an endpoint onto a layer supported only by a nearby same-net pad", (): void => {
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
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      layers: ["top"],
      zLayers: [0],
      center: { x: 0, y: 0 },
      width: 0.2,
      height: 0.2,
      connectedTo: [route.connectionName],
    },
    {
      type: "rect",
      layers: ["bottom"],
      zLayers: [1],
      center: { x: 0.24, y: 0 },
      width: 0.4,
      height: 0.4,
      connectedTo: [route.connectionName],
    },
  ]
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", obstacles),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
  })

  solver.solve()

  const optimizedRoute = solver.getOptimizedHdRoute()
  expect(solver.failed).toBe(false)
  expect(optimizedRoute.route[0]?.z).toBe(0)
  expect(optimizedRoute.vias).toEqual([{ x: 1, y: 0 }])
})

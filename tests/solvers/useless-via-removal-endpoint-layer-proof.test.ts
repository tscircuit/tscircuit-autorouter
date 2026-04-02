import { expect, test } from "bun:test"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

const baseRoute: HighDensityRoute = {
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

const solveRoute = (route: HighDensityRoute, obstacles: Obstacle[] = []) => {
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", obstacles),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  return solver.getOptimizedHdRoute()
}

test("does not remove the first-section via when endpoint layer support is unproven", () => {
  const optimizedRoute = solveRoute(baseRoute)

  expect(optimizedRoute.vias).toEqual([{ x: 1, y: 0 }])
  expect(optimizedRoute.route).toEqual(baseRoute.route)
})

test("removes the first-section via when a connected endpoint obstacle supports both layers", () => {
  const multilayerEndpointObstacle: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    zLayers: [0, 1],
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: [baseRoute.connectionName],
  }

  const optimizedRoute = solveRoute(baseRoute, [multilayerEndpointObstacle])

  expect(optimizedRoute.vias).toHaveLength(0)
  expect(optimizedRoute.route.every((point) => point.z === 1)).toBe(true)
})

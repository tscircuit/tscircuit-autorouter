import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const baseRoute: HighDensityRoute = {
  connectionName: "source_net_test",
  rootConnectionName: "source_net_test",
  startPcbPortId: "pcb_port_multilayer",
  endPcbPortId: "pcb_port_bottom",
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
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
    terminalLayerIndicesByPcbPortId: new Map([
      ["pcb_port_multilayer", new Set([0, 1])],
      ["pcb_port_bottom", new Set([1])],
    ]),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  return solver.getOptimizedHdRoute()
}

test("removes the first-section via when endpoint metadata and its obstacle support both layers", () => {
  const multilayerEndpointObstacle: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    __zLayers: [0, 1],
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: [baseRoute.connectionName],
  }

  const optimizedRoute = solveRoute(baseRoute, [multilayerEndpointObstacle])

  expect(optimizedRoute.vias).toHaveLength(0)
  expect(optimizedRoute.route.every((point) => point.z === 1)).toBe(true)
  expect(optimizedRoute.startPcbPortId).toBe(baseRoute.startPcbPortId)
  expect(optimizedRoute.endPcbPortId).toBe(baseRoute.endPcbPortId)
})

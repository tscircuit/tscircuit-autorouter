import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("trace simplification preserves endpoint layers for spliceable sections", () => {
  const route: HighDensityRoute = {
    connectionName: "editable",
    rootConnectionName: "net0",
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
  const endpointObstacle: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: [route.connectionName],
  }
  const solver = new TraceSimplificationSolver({
    hdRoutes: [route],
    obstacles: [endpointObstacle],
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
    preserveRouteEndpoints: true,
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.simplifiedHdRoutes[0]!.route[0]).toEqual(route.route[0])
  expect(solver.simplifiedHdRoutes[0]!.route.at(-1)).toEqual(route.route.at(-1))
  expect(solver.simplifiedHdRoutes[0]!.vias).toEqual(route.vias)
})

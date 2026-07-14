import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("runs via-pair rerouting as part of trace simplification", () => {
  const route: HighDensityRoute = {
    connectionName: "route-to-simplify",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
  }
  const blocker: HighDensityRoute = {
    connectionName: "blocking-route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 2, y: -1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ],
    vias: [],
  }
  const solver = new TraceSimplificationSolver({
    hdRoutes: [route, blocker],
    obstacles: [],
    connMap: new ConnectivityMap({
      netA: [route.connectionName],
      netB: [blocker.connectionName],
    }),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.simplifiedHdRoutes[0].vias).toHaveLength(0)
  expect(
    solver.simplifiedHdRoutes[0].route.some((point) => Math.abs(point.y) > 1),
  ).toBe(true)
})

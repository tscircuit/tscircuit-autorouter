import { expect, test } from "bun:test"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

test("SingleSimplifiedPathSolver5 preserves target connection points", () => {
  const inputRoute: HighDensityIntraNodeRoute = {
    connectionName: "netA",
    traceThickness: 0.2,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }

  const connections = [
    {
      name: "netA",
      pointsToConnect: [{ x: 1, y: 0, layer: "top" }],
    },
  ]

  // Solver without connections: simplifies straight line (0,0) -> (2,0)
  const solverWithout = new SingleSimplifiedPathSolver5({
    inputRoute,
    otherHdRoutes: [],
    obstacles: [],
    connMap: new ConnectivityMap({
      connections: [],
      obstacles: [],
    } as any),
    colorMap: {},
  })
  solverWithout.solve()
  const simplifiedWithout = solverWithout.simplifiedRoute
  // Solver with connections: should preserve the (1,0) connection point
  const solverWith = new SingleSimplifiedPathSolver5({
    inputRoute,
    otherHdRoutes: [],
    obstacles: [],
    connMap: new ConnectivityMap({
      connections: [],
      obstacles: [],
    } as any),
    colorMap: {},
    connections,
  })
  solverWith.solve()
  const simplifiedWith = solverWith.simplifiedRoute

  // Verify that the middle connection point (1,0) is preserved in the "with" route
  const hasMiddlePoint = simplifiedWith.route.some(
    (p) => Math.abs(p.x - 1) < 0.01 && Math.abs(p.y - 0) < 0.01,
  )
  expect(hasMiddlePoint).toBe(true)

  // Verify that in the "without" route, there is no point at x = 1
  const hasMiddlePointWithout = simplifiedWithout.route.some(
    (p) => Math.abs(p.x - 1) < 0.01 && Math.abs(p.y - 0) < 0.01,
  )
  expect(hasMiddlePointWithout).toBe(false)
})

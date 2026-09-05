import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { VertexShortcutPathSolver } from "lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("vertex shortcuts do not replace a short non-45-degree path with a longer dogleg", () => {
  const inputRoute: HighDensityRoute = {
    connectionName: "short-diagonal",
    traceThickness: 0.15,
    viaDiameter: 0.4,
    vias: [],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0.4, z: 0 },
      { x: 2, y: 0.8, z: 0 },
    ],
  }
  const solver = new VertexShortcutPathSolver({
    inputRoute,
    otherHdRoutes: [],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.simplifiedRoute.route).toEqual(inputRoute.route)
})

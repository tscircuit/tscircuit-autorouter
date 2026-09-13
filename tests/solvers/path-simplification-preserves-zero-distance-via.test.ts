import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("path simplification preserves a via at the route start", () => {
  const inputRoute: HighDensityRoute = {
    connectionName: "route",
    rootConnectionName: "net",
    traceThickness: 0.1,
    viaDiameter: 0.45,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ],
  }
  const solver = new SingleSimplifiedPathSolver5({
    inputRoute,
    otherHdRoutes: [],
    obstacles: [],
    connMap: new ConnectivityMap({ net: [inputRoute.connectionName] }),
    colorMap: {},
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.simplifiedRoute.vias).toContainEqual({ x: 0, y: 0 })
  for (let index = 1; index < solver.simplifiedRoute.route.length; index++) {
    const previous = solver.simplifiedRoute.route[index - 1]!
    const point = solver.simplifiedRoute.route[index]!
    if (previous.z === point.z) continue
    expect({ x: point.x, y: point.y }).toEqual({
      x: previous.x,
      y: previous.y,
    })
  }
})

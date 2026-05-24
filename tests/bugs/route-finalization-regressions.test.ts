import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { SingleSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("EscapeViaLocationSolver requires trace radius plus full obstacle margin", () => {
  const srj = {
    minTraceWidth: 0.2,
    defaultObstacleMargin: 0.15,
    connections: [],
    obstacles: [],
  } as unknown as SimpleRouteJson

  const solver = new EscapeViaLocationSolver(srj, {
    viaDiameter: 0.6,
    minTraceWidth: 0.2,
    obstacleMargin: 0.15,
  })

  expect(solver.requiredTraceClearance).toBeCloseTo(0.25)
})

test("SingleSimplifiedPathSolver drops consecutive duplicate same-layer points", () => {
  const inputRoute: HighDensityIntraNodeRoute = {
    connectionName: "source_net_1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }

  const solver = new SingleSimplifiedPathSolver({
    inputRoute,
    otherHdRoutes: [],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
  })

  expect(solver.inputRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
})

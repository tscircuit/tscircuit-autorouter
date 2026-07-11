import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("multiple stitch selects a route-supported multi-layer terminal layer", () => {
  const hdRoute: HighDensityIntraNodeRoute = {
    connectionName: "conn",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ],
    vias: [],
    jumpers: [],
  }
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "conn",
        pointsToConnect: [
          { x: 0, y: 0, layers: ["top", "inner2", "bottom"] },
          { x: 2, y: 0, layers: ["top", "inner2", "bottom"] },
        ],
      },
    ],
    hdRoutes: [hdRoute],
    layerCount: 4,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]?.route).toEqual([
    { x: 0, y: 0, z: 2 },
    { x: 2, y: 0, z: 2 },
  ])
  expect(solver.mergedHdRoutes[0]?.vias).toEqual([])
})

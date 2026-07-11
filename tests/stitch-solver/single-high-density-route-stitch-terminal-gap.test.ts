import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("single stitch can cap a modest same-layer terminal gap", () => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "conn",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.2, y: 1.3, z: 0 },
      { x: 0.3, y: 1.1, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 2, z: 0 },
    end: { x: 0, y: 0, z: 0 },
    hdRoutes: [route],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 2, z: 0 },
    { x: 0.2, y: 1.3, z: 0 },
    { x: 0.3, y: 1.1, z: 0 },
    { x: 0, y: 0, z: 0 },
  ])
})

import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("single stitch preserves terminal layers when traversal is reversed", () => {
  const hdRoute: HighDensityIntraNodeRoute = {
    connectionName: "conn",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 5 },
      { x: 3, y: 0, z: 5 },
    ],
    vias: [],
    jumpers: [],
  }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 3, y: 0, z: 5 },
    end: { x: 0, y: 0, z: 0 },
    hdRoutes: [hdRoute],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 5 },
    { x: 3, y: 0, z: 5 },
  ])
  expect(solver.mergedHdRoute.vias).toEqual([{ x: 0, y: 0 }])
})

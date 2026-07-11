import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("single stitch fails when a terminal layer transition is not allowed", () => {
  const hdRoute: HighDensityIntraNodeRoute = {
    connectionName: "conn",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 5 },
    hdRoutes: [hdRoute],
    allowedLayerTransitionPointKeys: new Set(),
  })

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("layer transition")
  expect(solver.error).toContain("is not allowed")
  expect(solver.mergedHdRoute.vias).toEqual([])
})

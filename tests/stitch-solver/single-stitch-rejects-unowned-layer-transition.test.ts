import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching fails without discarding copper when no layer transition is authorized", (): void => {
  const firstRoute: HighDensityIntraNodeRoute = {
    connectionName: "missing_transition",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
    vias: [],
  }
  const secondRoute: HighDensityIntraNodeRoute = {
    connectionName: "missing_transition",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [],
  }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "missing_transition",
    hdRoutes: [firstRoute, secondRoute],
    start: { x: -1, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 1 },
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe(
    'Route stitch for "missing_transition" cannot connect 1 unconsumed route fragment(s) from (0, 0, z=0)',
  )
  expect(solver.remainingHdRoutes).toEqual([secondRoute])
  expect(solver.mergedHdRoute.route).toEqual([
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  ])
  expect(solver.mergedHdRoute.vias).toEqual([])
})

import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("single stitch fails without discarding copper across large same-layer gaps", (): void => {
  const hdRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "conn",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      jumpers: [],
    },
    {
      connectionName: "conn",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 2.5, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      vias: [],
      jumpers: [],
    },
  ]
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 3, y: 0, z: 0 },
    hdRoutes,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe(
    'Route stitch for "conn" cannot connect 1 unconsumed route fragment(s) from (1, 0, z=0)',
  )
  expect(solver.remainingHdRoutes).toEqual([hdRoutes[1]])
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ])
})

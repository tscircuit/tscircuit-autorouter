import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("route stitching materializes an implied layer transition as a via", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "connection",
    hdRoutes: [
      {
        connectionName: "connection",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1.1, y: 0, z: 1 },
          { x: 2, y: 0, z: 1 },
        ],
        vias: [],
      },
    ],
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 1 },
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1.1, y: 0, z: 0 },
    { x: 1.1, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
  ])
  expect(solver.mergedHdRoute.vias).toEqual([{ x: 1.1, y: 0 }])
})

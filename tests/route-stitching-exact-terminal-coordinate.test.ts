import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("route stitching preserves the exact terminal coordinate within geometric tolerance", () => {
  const exactStart = { x: 0.123340833333333, y: 0, z: 0 }
  const exactEnd = { x: 30.983340833333333, y: -4.5680968, z: 0 }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "breakout_connection",
    start: exactStart,
    end: exactEnd,
    hdRoutes: [
      {
        connectionName: "breakout_connection",
        route: [
          { x: 0.123, y: 0, z: 0 },
          { x: 30.983, y: -4.568, z: 0 },
        ],
        vias: [],
        jumpers: [],
        traceThickness: 0.15,
        viaDiameter: 0.6,
      },
    ],
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route[0]).toMatchObject(exactStart)
  expect(solver.mergedHdRoute.route.at(-1)).toMatchObject(exactEnd)
})

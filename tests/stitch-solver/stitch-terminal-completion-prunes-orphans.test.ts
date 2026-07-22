import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  points: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName: "conn",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias: [],
})

test("validated terminal completion discards disconnected orphan fragments", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 0 },
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 0 },
        { x: 0.1, y: 0, z: 0 },
      ]),
      makeRoute([
        { x: 2, y: 2, z: 1 },
        { x: 2.1, y: 2, z: 1 },
      ]),
    ],
    isValidStitchSegment: () => true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0.1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ])
})

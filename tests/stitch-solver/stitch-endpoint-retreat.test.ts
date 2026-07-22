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
  jumpers: [],
})

test("stitch repair retracts colliding fragment tails before rerouting", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 0 },
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 0 },
        { x: 0.8, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
      makeRoute([
        { x: 1.1, y: 0, z: 0 },
        { x: 1.3, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]),
    ],
    isValidStitchSegment: ({ start, end }) =>
      Math.max(start.x, end.x) <= 0.8,
    findValidStitchPath: ({ start, end }) => {
      if (Math.abs(start.x - 0.8) > 1e-6) return undefined
      if (Math.abs(end.x - 1.3) > 1e-6) return undefined
      return [start, { x: 1.05, y: 0.5, z: 0 }, end]
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0.8, y: 0, z: 0 },
    { x: 1.05, y: 0.5, z: 0 },
    { x: 1.3, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
})

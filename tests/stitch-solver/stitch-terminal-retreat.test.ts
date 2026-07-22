import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("terminal stitch repair retracts a colliding planar tail", () => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "conn",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.8, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1.1, y: 0, z: 0 },
    hdRoutes: [route],
    isValidStitchSegment: ({ start, end }) =>
      Math.max(start.x, end.x) <= 0.8,
    findValidStitchPath: ({ start, end }) => {
      if (Math.abs(start.x - 0.8) > 1e-6) return undefined
      if (Math.abs(end.x - 1.1) > 1e-6) return undefined
      return [start, { x: 0.95, y: 0.4, z: 0 }, end]
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0.8, y: 0, z: 0 },
    { x: 0.95, y: 0.4, z: 0 },
    { x: 1.1, y: 0, z: 0 },
  ])
})

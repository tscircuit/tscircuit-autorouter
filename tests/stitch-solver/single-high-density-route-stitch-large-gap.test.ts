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

test("single stitch fails instead of dropping a fragment across a large gap", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 3, y: 0, z: 0 },
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
      makeRoute([
        { x: 2.5, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ]),
    ],
  })

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("no stitchable fragment remains")
})

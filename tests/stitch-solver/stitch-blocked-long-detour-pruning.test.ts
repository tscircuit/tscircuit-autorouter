import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  startX: number,
  endX: number,
): HighDensityIntraNodeRoute => ({
  connectionName: "conn",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
})

test("blocked distant fragments do not launch local visibility detours", () => {
  const detourDistances: number[] = []
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 20, y: 0, z: 0 },
    hdRoutes: [makeRoute(0, 0.1), makeRoute(10, 10.1)],
    isValidStitchSegment: () => false,
    findValidStitchPath: ({ start, end }) => {
      detourDistances.push(Math.hypot(start.x - end.x, start.y - end.y))
      return undefined
    },
  })

  solver.solve()

  expect(solver.failed).toBe(true)
  expect(detourDistances.every((value) => value <= 1.25)).toBe(true)
})

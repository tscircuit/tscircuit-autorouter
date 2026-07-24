import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  startX: number,
  endX: number,
): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName: "root",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
  jumpers: [],
})

test("terminal selection prunes candidates whose exact lower bound cannot win", () => {
  const evaluatedTerminalEndpoints: number[] = []

  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "candidate",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 10, y: 0, z: 0 },
    hdRoutes: [
      makeRoute("near_start", 0.1, 0.2),
      makeRoute("distant", 5, 6),
      makeRoute("near_end", 9.8, 9.9),
    ],
    isValidStitchSegment: ({ start, end }) => {
      if (start.x === 0 || start.x === 10) {
        evaluatedTerminalEndpoints.push(end.x)
      }
      return true
    },
  })

  expect(solver.failed).toBe(false)
  expect(evaluatedTerminalEndpoints).not.toContain(5)
  expect(evaluatedTerminalEndpoints).not.toContain(6)
})

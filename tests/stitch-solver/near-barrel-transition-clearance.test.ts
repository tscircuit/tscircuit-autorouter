import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { nearBarrelSegments } from "./fixtures/nearBarrelTransition"

test("checks short barrel connectors for copper clearance", (): void => {
  const blockedQueries: number[] = []
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: 20, y: -0.965, z: 1 },
    end: { x: 22, y: -0.965, z: 3 },
    hdRoutes: structuredClone(nearBarrelSegments),
    isStitchSegmentClear: ({ start, end }): boolean => {
      blockedQueries.push(Math.hypot(start.x - end.x, start.y - end.y))
      return false
    },
    stitchClearanceMode: "require_clear",
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("violates copper clearance")
  expect(
    blockedQueries.some((length): boolean => length > 0 && length < 1e-3),
  ).toBe(true)
})

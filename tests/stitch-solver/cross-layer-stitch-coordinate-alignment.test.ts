import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const createRoute = (
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
  vias: Array<{ x: number; y: number }> = [],
): HighDensityIntraNodeRoute => ({
  connectionName: "net",
  rootConnectionName: "net",
  traceThickness: 0.15,
  viaDiameter: 0.6,
  route: [start, end],
  vias,
})

test("aligns a tolerance-matched cross-layer stitch and its via", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "net",
    hdRoutes: [
      createRoute({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      {
        ...createRoute({ x: 1.0004, y: 0.0003, z: 0 }, { x: 2, y: 0, z: 1 }, [
          { x: 1.0004, y: 0.0003 },
        ]),
        route: [
          { x: 1.0004, y: 0.0003, z: 0 },
          { x: 1.0004, y: 0.0003, z: 1 },
          { x: 2, y: 0, z: 1 },
        ],
      },
    ],
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 1 },
    enableCompleteTerminalStitching: true,
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  const transitions = solver.mergedHdRoute.route.flatMap(
    (point, index, route) =>
      index > 0 && route[index - 1]!.z !== point.z
        ? [[route[index - 1]!, point] as const]
        : [],
  )
  expect(transitions).toEqual([
    [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ],
  ])
  expect(solver.mergedHdRoute.vias).toContainEqual({ x: 1, y: 0 })
})

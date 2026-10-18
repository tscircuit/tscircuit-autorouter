import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("legacy stitching cannot turn a rounded via entry into a diagonal transition", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 1 },
    enableCompleteTerminalStitching: false,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "signal",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 1.0004, y: 0.0003, z: 0 },
          { x: 1.0004, y: 0.0003, z: 1 },
          { x: 2, y: 0, z: 1 },
        ],
        vias: [{ x: 1.0004, y: 0.0003 }],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const transitions = solver.mergedHdRoute.route.flatMap(
    (point, index, route) =>
      index > 0 && route[index - 1]!.z !== point.z
        ? [[route[index - 1]!, point]]
        : [],
  )
  expect(transitions).toEqual([
    [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ],
  ])
  expect(solver.mergedHdRoute.vias).toEqual([{ x: 1, y: 0 }])
})

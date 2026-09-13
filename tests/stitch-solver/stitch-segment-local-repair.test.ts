import { expect, test } from "bun:test"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const createRoute = (
  connectionName: string,
  route: HighDensityIntraNodeRoute["route"],
): HighDensityIntraNodeRoute => ({
  connectionName,
  route,
  vias: [],
  jumpers: [],
  traceThickness: 0.1,
  viaDiameter: 0.3,
})

test("repairs a collision-blocked stitch with a local copper-clear detour", () => {
  const targetRoutes = [
    createRoute("target", [
      { x: -1, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 0 },
    ]),
    createRoute("target", [
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]),
  ]
  const foreignRoute = createRoute("foreign", [
    { x: 0, y: -0.2, z: 0 },
    { x: 0, y: 0.2, z: 0 },
  ])
  const validator = new RouteStitchClearanceValidator({
    hdRoutes: [...targetRoutes, foreignRoute],
  })
  const directStitch = {
    connectionName: "target",
    start: targetRoutes[0]!.route[1]!,
    end: targetRoutes[1]!.route[0]!,
    traceThickness: 0.1,
  }
  expect(validator.isSegmentClear(directStitch)).toBe(false)

  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "target",
    start: { x: -1, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 0 },
    hdRoutes: targetRoutes,
    isStitchSegmentClear: (segment) => validator.isSegmentClear(segment),
    findStitchSegmentPath: (segment) => validator.findClearPath(segment),
    stitchClearanceMode: "require_clear",
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const repairedRoute = solver.mergedHdRoute.route
  expect(repairedRoute[0]).toEqual({ x: -1, y: 0, z: 0 })
  expect(repairedRoute[repairedRoute.length - 1]).toEqual({
    x: 1,
    y: 0,
    z: 0,
  })
  expect(repairedRoute.some((point) => point.y !== 0)).toBe(true)
  for (let pointIndex = 1; pointIndex < repairedRoute.length; pointIndex += 1) {
    expect(
      validator.isSegmentClear({
        ...directStitch,
        start: repairedRoute[pointIndex - 1]!,
        end: repairedRoute[pointIndex]!,
      }),
    ).toBe(true)
  }
})

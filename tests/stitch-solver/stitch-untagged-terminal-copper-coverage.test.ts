import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("an untagged reroute terminal is reached when trace copper covers it", () => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "reroute",
    rootConnectionName: "source_trace",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.96, y: 0, z: 0 },
    ],
    vias: [],
  }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: route.connectionName,
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 0 },
    hdRoutes: [route],
    isValidStitchSegment: () => false,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route.at(-1)).toEqual({ x: 0.96, y: 0, z: 0 })
})

import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { selectRoutesAlongEndpointPath } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("endpoint path selection can place a terminal-only gap at the end of reversed traversal", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "reversed-gap",
    rootConnectionName: "reversed-gap",
    regionId: "main",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const start = { x: 2.2, y: 0, z: 0 }
  const end = { x: 0, y: 0, z: 0 }

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "reversed-gap",
    hdRoutes: [route],
    start,
    end,
    canStitchBetweenTerminals: (selection): boolean => {
      const solver = new SingleHighDensityRouteStitchSolver3(selection)
      solver.solve()
      return solver.solved && !solver.failed
    },
  })

  expect(selectedRoutes).toEqual([route])
})

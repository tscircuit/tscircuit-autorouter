import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("gap-count-first path selection still bridges disconnected copper islands", (): void => {
  const makeRoute = (
    startX: number,
    endX: number,
  ): HighDensityIntraNodeRoute => ({
    connectionName: "islands",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: startX, y: 0, z: 0 },
      { x: endX, y: 0, z: 0 },
    ],
    vias: [],
  })
  const routes = [makeRoute(0, 1), makeRoute(1.5, 3), makeRoute(3, 4)]
  const start = { x: 0, y: 0, z: 0 }
  const end = { x: 4, y: 0, z: 0 }
  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "islands",
    hdRoutes: [routes[2]!, routes[0]!, routes[1]!],
    start,
    end,
    endpointIndex: new EndpointClusterIndex(true),
    canStitchBetweenTerminals: (): boolean => true,
  })
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "islands",
    hdRoutes: selectedRoutes,
    start,
    end,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(selectedRoutes).toEqual(routes)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1.5, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ])
})

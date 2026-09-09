import { expect, test } from "bun:test"
import {
  type CanStitchBetweenTerminals,
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("two short repair seams preserve routed copper instead of one longer shortcut", (): void => {
  const makeRoute = (
    route: HighDensityIntraNodeRoute["route"],
  ): HighDensityIntraNodeRoute => ({
    connectionName: "repair_seams",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route,
    vias: [],
  })
  const start = { x: -2, y: 0, z: 0 }
  const end = { x: 2, y: 0, z: 0 }
  const routes = [
    makeRoute([start, { x: 0, y: 0, z: 0 }]),
    makeRoute([
      { x: 0, y: 0.2, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 0.9, y: 2, z: 0 },
      { x: 0.9, y: 0.2, z: 0 },
    ]),
    makeRoute([{ x: 0.9, y: 0, z: 0 }, end]),
  ]
  const validator = new RouteStitchClearanceValidator({ hdRoutes: routes })
  const canStitchBetweenTerminals: CanStitchBetweenTerminals = (
    params,
  ): boolean => {
    const solver = new SingleHighDensityRouteStitchSolver3({
      ...params,
      isStitchSegmentClear: (segment): boolean =>
        validator.isSegmentClear(segment),
      stitchClearanceMode: "require_clear",
    })
    solver.solve()
    return solver.solved && !solver.failed
  }

  // Both alternatives pass the real clearance callback. The distinction is
  // 0.2 + 0.2 mm of repaired seams versus 0.9 mm of invented shortcut copper.
  expect(
    canStitchBetweenTerminals({
      connectionName: "repair_seams",
      hdRoutes: [routes[0]!, routes[2]!],
      start,
      end,
    }),
  ).toBe(true)
  expect(
    canStitchBetweenTerminals({
      connectionName: "repair_seams",
      hdRoutes: routes,
      start,
      end,
    }),
  ).toBe(true)

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "repair_seams",
    hdRoutes: [...routes].reverse(),
    start,
    end,
    endpointIndex: new EndpointClusterIndex(true),
    canStitchBetweenTerminals,
  })

  expect(selectedRoutes).toEqual(routes)
})

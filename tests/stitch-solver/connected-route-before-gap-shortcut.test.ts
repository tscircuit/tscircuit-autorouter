import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("uses the existing connected path before inventing a gap shortcut past a branch", () => {
  const points = [
    [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }],
    [{ x: 0, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }],
    [{ x: 2, y: 2, z: 0 }, { x: 0.5, y: 0, z: 0 }],
    [{ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }],
  ]
  const routes: HighDensityIntraNodeRoute[] = points.map((route) => ({
    connectionName: "net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route,
    vias: [],
  }))
  const selected = selectRoutesAlongEndpointPath({
    connectionName: "net",
    hdRoutes: routes,
    start: points[0][0],
    end: points[2][1],
    endpointIndex: new EndpointClusterIndex(true),
    canStitchBetweenTerminals: () => true,
  })
  expect(new Set(selected)).toEqual(new Set(routes.slice(0, 3)))
})

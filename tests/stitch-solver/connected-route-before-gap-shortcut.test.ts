import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("rejects a blocked gap shortcut while retaining the connected copper path", () => {
  const points = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
    ],
    [
      { x: 0, y: 2, z: 0 },
      { x: 2, y: 2, z: 0 },
    ],
    [
      { x: 2, y: 2, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
    [
      { x: 0, y: 0, z: 0 },
      { x: 0.1, y: 0, z: 0 },
    ],
  ]
  const routes: HighDensityIntraNodeRoute[] = points.map((route) => ({
    connectionName: "net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route,
    vias: [],
  }))
  routes[0].startPcbPortId = "a"
  routes[2].endPcbPortId = "b"
  const validator = new RouteStitchClearanceValidator({
    hdRoutes: [
      {
        connectionName: "foreign",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0.25, y: -0.5, z: 0 },
          { x: 0.25, y: 0.5, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  const selected = selectRoutesAlongEndpointPath({
    connectionName: "net",
    hdRoutes: routes,
    start: points[0][0],
    end: points[2][1],
    endpointIndex: new EndpointClusterIndex(true),
    canStitchBetweenTerminals: () => true,
    isStitchSegmentClear: (segment) => validator.isSegmentClear(segment),
  })
  expect(new Set(selected)).toEqual(new Set(routes.slice(0, 3)))
})

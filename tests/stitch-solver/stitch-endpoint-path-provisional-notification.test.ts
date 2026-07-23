import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

const makeRoute = (
  startX: number,
  endX: number,
): HighDensityIntraNodeRoute => ({
  connectionName: "conn",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
})

test("reports only endpoint paths that require downstream DRC repair", () => {
  const terminalRoute = makeRoute(0, 1)
  const continuationRoute = makeRoute(1.5, 2)
  const unrelatedRoute = makeRoute(5, 6)

  const selection = selectRoutesAlongEndpointPath({
    connectionName: "conn",
    hdRoutes: [terminalRoute, continuationRoute, unrelatedRoute],
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 0 },
    endpointIndex: new EndpointClusterIndex(),
    getStitchRepairPolicyBetweenTerminals: () => null,
    isValidStitchGap: () => false,
    stitchRepairPolicy: "allow_drc_repair",
  })

  expect(selection).toEqual({
    hdRoutes: [terminalRoute],
    stitchRepairPolicy: "allow_drc_repair",
  })
})

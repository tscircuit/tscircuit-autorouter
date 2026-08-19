import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

const makeRoute = (startX: number, endX: number): HighDensityIntraNodeRoute => ({
  connectionName: "conn",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
  jumpers: [],
})

test("endpoint path does not replace terminal routes with a geometric shortcut", () => {
  const routes = [makeRoute(0, 0.5), makeRoute(0.5, 1), makeRoute(1, 1.5)]

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "conn",
    hdRoutes: routes,
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1.5, y: 0, z: 0 },
    endpointIndex: new EndpointClusterIndex(),
    canStitchBetweenTerminals: () => true,
  })

  expect(selectedRoutes).toHaveLength(3)
})

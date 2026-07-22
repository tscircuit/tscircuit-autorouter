import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  startX: number,
  endX: number,
): HighDensityIntraNodeRoute => ({
  connectionName: "candidate",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
  jumpers: [],
})

test("endpoint path keeps a collision-routable subset instead of unrelated islands", () => {
  const firstRoute = makeRoute(0, 1)
  const secondRoute = makeRoute(1.5, 2)
  const unrelatedRoute = makeRoute(5, 6)

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "candidate",
    hdRoutes: [firstRoute, secondRoute, unrelatedRoute],
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 0 },
    endpointIndex: new EndpointClusterIndex(),
    canStitchBetweenTerminals: () => false,
    isValidStitchGap: () => true,
  })

  expect(selectedRoutes).toEqual([firstRoute])
})

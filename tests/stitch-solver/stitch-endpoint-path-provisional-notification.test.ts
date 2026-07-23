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

test("reports only endpoint paths that require provisional DRC repair", () => {
  const terminalRoute = makeRoute(0, 1)
  const continuationRoute = makeRoute(1.5, 2)
  const unrelatedRoute = makeRoute(5, 6)
  let provisionalSelectionCount = 0

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "conn",
    hdRoutes: [terminalRoute, continuationRoute, unrelatedRoute],
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 0 },
    endpointIndex: new EndpointClusterIndex(),
    canStitchBetweenTerminals: () => false,
    isValidStitchGap: () => false,
    allowProvisionalStitchSegmentsForDrcRepair: true,
    onProvisionalPathSelected: () => {
      provisionalSelectionCount += 1
    },
  })

  expect(selectedRoutes).toEqual([terminalRoute])
  expect(provisionalSelectionCount).toBe(1)
})

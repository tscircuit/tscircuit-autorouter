import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  RouteEndpointPathIndex,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const getRoute = (
  connectionName: string,
  startX: number,
  endX: number,
): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName: "power_net",
  traceThickness: 0.2,
  viaDiameter: 0.6,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
  jumpers: [],
})

test("reuses one same-root endpoint graph for sibling connections", (): void => {
  const firstRoute = getRoute("branch_1", 0, 2)
  const middleRoute = getRoute("branch_2", 2.5, 4)
  const lastRoute = getRoute("branch_3", 4.5, 6)
  const unrelatedRoute = getRoute("branch_4", 10, 12)
  const pathIndex = new RouteEndpointPathIndex({
    endpointGroupName: "power_net",
    hdRoutes: [firstRoute, middleRoute, lastRoute, unrelatedRoute],
    endpointIndex: new EndpointClusterIndex(true),
  })

  const firstSelection = pathIndex.selectRoutes({
    connectionName: "branch_1",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 6, y: 0, z: 0 },
    canStitchBetweenTerminals: () => true,
  })
  const secondSelection = pathIndex.selectRoutes({
    connectionName: "branch_2",
    start: { x: 2.5, y: 0, z: 0 },
    end: { x: 6, y: 0, z: 0 },
    canStitchBetweenTerminals: () => true,
  })

  expect(firstSelection).toEqual([firstRoute, middleRoute, lastRoute])
  expect(secondSelection).toEqual([middleRoute, lastRoute])
})

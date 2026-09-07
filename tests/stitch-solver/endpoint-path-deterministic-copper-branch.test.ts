import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("equal-cost copper paths keep deterministic selection across input ordering", (): void => {
  const makeRoute = (
    regionId: string,
    route: HighDensityIntraNodeRoute["route"],
  ): HighDensityIntraNodeRoute => ({
    connectionName: "branches",
    regionId,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route,
    vias: [],
  })
  const start = { x: 0, y: 0, z: 0 }
  const end = { x: 4, y: 0, z: 0 }
  const lowerMidpoint = { x: 2, y: -1, z: 0 }
  const upperMidpoint = { x: 2, y: 1, z: 0 }
  const routes = [
    makeRoute("lower_start", [start, lowerMidpoint]),
    makeRoute("lower_end", [lowerMidpoint, end]),
    makeRoute("upper_start", [start, upperMidpoint]),
    makeRoute("upper_end", [upperMidpoint, end]),
  ]
  const routeOrders = [
    routes,
    [...routes].reverse(),
    [routes[1]!, routes[3]!, routes[0]!, routes[2]!].map(
      (route): HighDensityIntraNodeRoute => ({
        ...route,
        route: [...route.route].reverse(),
      }),
    ),
  ]

  for (const hdRoutes of routeOrders) {
    const selectedRoutes = selectRoutesAlongEndpointPath({
      connectionName: "branches",
      hdRoutes,
      start,
      end,
      endpointIndex: new EndpointClusterIndex(true),
      canStitchBetweenTerminals: (): boolean => true,
    })

    expect(
      selectedRoutes.map((route): string | undefined => route.regionId),
    ).toEqual(["lower_start", "lower_end"])
  }
})

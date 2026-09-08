import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("endpoint paths retain connected copper instead of taking gap shortcuts", (): void => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 2, z: 0 },
    { x: 2.5, y: 2, z: 0 },
    { x: 2.5, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  const hdRoutes: HighDensityIntraNodeRoute[] = points
    .slice(1)
    .map((end, index) => ({
      connectionName: "connected_copper",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [points[index]!, end],
      vias: [],
    }))

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "connected_copper",
    hdRoutes,
    start: points[0]!,
    end: points[points.length - 1]!,
    endpointIndex: new EndpointClusterIndex(),
    canStitchBetweenTerminals: () => true,
  })

  expect(selectedRoutes).toEqual(hdRoutes)

  const directCopper: HighDensityIntraNodeRoute = {
    ...hdRoutes[0]!,
    route: [points[1]!, points[4]!],
  }
  const shorterConnectedPath = selectRoutesAlongEndpointPath({
    connectionName: "connected_copper",
    hdRoutes: [...hdRoutes, directCopper].reverse(),
    start: points[0]!,
    end: points[points.length - 1]!,
    endpointIndex: new EndpointClusterIndex(),
    canStitchBetweenTerminals: () => true,
  })
  expect(shorterConnectedPath).toEqual([
    hdRoutes[0]!,
    directCopper,
    hdRoutes[4]!,
  ])
})

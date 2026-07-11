import { expect, test } from "bun:test"
import { selectRoutesAlongEndpointPath } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  regionId: string,
  points: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName: "disconnected-conn",
  rootConnectionName: "disconnected-conn",
  regionId,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias: [],
  jumpers: [],
})

test("endpoint path selection fails loudly when fragments cannot connect the terminals", (): void => {
  const routes = [
    makeRoute("left", [
      { x: 0, y: 0, z: 0 },
      { x: 0.2, y: 0, z: 0 },
    ]),
    makeRoute("right", [
      { x: 2, y: 0, z: 0 },
      { x: 2.2, y: 0, z: 0 },
    ]),
  ]

  expect(() =>
    selectRoutesAlongEndpointPath({
      connectionName: "disconnected-conn",
      hdRoutes: routes,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 2.2, y: 0, z: 0 },
      canStitchBetweenTerminals: (): boolean => true,
    }),
  ).toThrow(
    'Cannot select stitch path for connection "disconnected-conn": no terminal-to-terminal fragment path exists within stitch limits',
  )
})

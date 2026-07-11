import { expect, test } from "bun:test"
import { selectRoutesAlongEndpointPath } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  regionId: string,
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
): HighDensityIntraNodeRoute => ({
  connectionName: "cyclic-connection",
  rootConnectionName: "cyclic-connection",
  regionId,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [start, end],
  vias: [],
  jumpers: [],
})

test("endpoint path selection keeps physical fragments unique on a cyclic graph", (): void => {
  const start = { x: 0, y: 0, z: 0 }
  const junction = { x: 1, y: 0, z: 0 }
  const loopEnd = { x: 1, y: 1, z: 0 }
  const end = { x: 2, y: 0, z: 0 }
  const routes = [
    makeRoute("entry", start, junction),
    makeRoute("loop-out", junction, loopEnd),
    makeRoute("loop-back", loopEnd, junction),
    makeRoute("exit", junction, end),
  ]

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "cyclic-connection",
    hdRoutes: routes,
    start,
    end,
    canStitchBetweenTerminals: (): boolean => true,
  })
  const selectedRegionIds = selectedRoutes.map((route) => route.regionId)

  expect(selectedRegionIds).toEqual(["entry", "exit"])
  expect(new Set(selectedRegionIds).size).toBe(selectedRegionIds.length)
})

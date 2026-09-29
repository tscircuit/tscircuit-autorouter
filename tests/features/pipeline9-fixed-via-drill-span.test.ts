import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9FixedRouteObstacles,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 fixed copper uses the drill span without changing signal layers", (): void => {
  const viaRoute: PreloadedHighDensityRoute = {
    connectionName: "top-to-inner1",
    traceThickness: 0.2,
    viaDiameter: 0.6,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
  }
  const bottomRoute: HighDensityRoute = {
    connectionName: "bottom-wire",
    traceThickness: 0.2,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: -1, z: 3 },
      { x: 0, y: 1, z: 3 },
    ],
    vias: [],
  }
  const originalRoute = structuredClone(viaRoute)
  const bottomVia: HighDensityRoute = {
    ...bottomRoute,
    route: [
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 0, z: 3 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  // Reuse the same route across policies to catch stale geometry-cache entries.
  for (const allowBlindAndBuriedVias of [true, false, undefined, true]) {
    const board = { layerCount: 4, allowBlindAndBuriedVias }
    const expectedLayers = allowBlindAndBuriedVias
      ? ["top", "inner1"]
      : ["top", "inner1", "inner2", "bottom"]
    const obstacles = getPipeline9FixedRouteObstacles({
      fixedObstacleRoutes: [viaRoute],
      ...board,
    })
    expect(
      obstacles.find((obstacle) => obstacle.obstacleId?.endsWith("via_0"))
        ?.layers,
    ).toEqual(expectedLayers)
    expect(getPipeline9RouteCopperGeometry(viaRoute, board).viaSpans).toEqual([
      {
        center: { x: 0, y: 0 },
        minZ: 0,
        maxZ: allowBlindAndBuriedVias ? 1 : 3,
        diameter: 0.6,
      },
    ])
    for (const otherRoute of [bottomRoute, bottomVia]) {
      for (const swap of [false, true]) {
        expect(
          doPipeline9RoutesHaveCopperConflict({
            left: swap ? otherRoute : viaRoute,
            right: swap ? viaRoute : otherRoute,
            clearance: 0.15,
            ...board,
          }),
        ).toBe(!allowBlindAndBuriedVias)
      }
    }
  }
  expect(
    getPipeline9RouteCopperGeometry(viaRoute, { layerCount: 6 }).viaSpans[0]!
      .maxZ,
  ).toBe(5)
  expect(() =>
    getPipeline9RouteCopperGeometry(bottomVia, { layerCount: 2 }),
  ).toThrow('Invalid z "2" for layer count: 2')
  expect(viaRoute).toEqual(originalRoute)
})

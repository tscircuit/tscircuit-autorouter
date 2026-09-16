import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9FixedRouteObstacles,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 keeps through vias clear on layers beyond their routing endpoints", (): void => {
  for (const [layerCount, fromZ, toZ] of [
    [4, 0, 2],
    [4, 0, 0],
    [4, 2, 2],
    [4, 2, 0],
    [4, 1, 2],
    [10, 7, 3],
  ] as const) {
    const via: PreloadedHighDensityRoute = {
      connectionName: "power",
      rootConnectionName: "power",
      preloadedTraceIndex: 0,
      preloadedRouteIndex: 0,
      traceThickness: 0.15,
      viaDiameter: 0.6,
      route: [
        { x: 0, y: 0, z: fromZ },
        { x: 0, y: 0, z: toZ },
      ],
      vias: [{ x: 0, y: 0 }],
    }
    const original = structuredClone(via)
    const signal: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      route: [
        { x: -1, y: 0, z: layerCount - 1 },
        { x: 1, y: 0, z: layerCount - 1 },
      ],
      vias: [],
    }

    // Reusing a route across board policies must not reuse the wrong via span.
    for (const allowBlindAndBuriedVias of [true, undefined, false, true]) {
      const policy = { layerCount, allowBlindAndBuriedVias }
      expect(
        getPipeline9RouteCopperGeometry(via, policy).viaSpans[0],
      ).toMatchObject({
        minZ: allowBlindAndBuriedVias ? Math.min(fromZ, toZ) : 0,
        maxZ: allowBlindAndBuriedVias ? Math.max(fromZ, toZ) : layerCount - 1,
      })
      const obstacles = getPipeline9FixedRouteObstacles({
        fixedObstacleRoutes: [via],
        ...policy,
      })
      expect(obstacles[0]!.layers.includes("bottom")).toBe(
        !allowBlindAndBuriedVias,
      )
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left: signal,
          right: via,
          clearance: 0.1,
          viaLayerPolicy: policy,
        }),
      ).toBe(!allowBlindAndBuriedVias)
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left: via,
          right: signal,
          clearance: 0.1,
          viaLayerPolicy: policy,
        }),
      ).toBe(!allowBlindAndBuriedVias)
    }
    if (fromZ === toZ) {
      expect(
        getPipeline9RouteCopperGeometry({ ...via, vias: [] }, { layerCount })
          .viaSpans,
      ).toEqual([])
    }
    expect(via).toEqual(original)
  }
})

import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getRoutingZLayers } from "lib/utils/routing-layer-constraints"

test("invalid routing layer allow-lists fail clearly", () => {
  const baseSrj = {
    layerCount: 4,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  } satisfies SimpleRouteJson

  expect(() => getRoutingZLayers({ ...baseSrj, routingLayers: [] })).toThrow(
    "routingLayers must contain at least one board layer",
  )
  expect(() =>
    getRoutingZLayers({ ...baseSrj, routingLayers: ["top", "signal2"] }),
  ).toThrow('Invalid routing layer "signal2" for a 4-layer board')
  expect(() =>
    getRoutingZLayers({ ...baseSrj, routingLayers: ["top", "top"] }),
  ).toThrow("routingLayers must not contain duplicate board layers")
  expect(() =>
    getRoutingZLayers({
      ...baseSrj,
      layerCount: 1,
      routingLayers: ["bottom"],
    }),
  ).toThrow('Invalid routing layer "bottom" for a 1-layer board')
  expect(() =>
    getRoutingZLayers({
      ...baseSrj,
      layerCount: 1,
      routingLayers: ["top", "bottom"],
    }),
  ).toThrow('Invalid routing layer "bottom" for a 1-layer board')
})

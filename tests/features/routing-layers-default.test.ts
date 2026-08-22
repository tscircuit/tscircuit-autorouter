import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import {
  getRoutingZLayers,
  normalizeSrjRoutingLayers,
} from "lib/utils/routing-layer-constraints"

test("omitting routingLayers preserves every board layer", () => {
  const srj = {
    layerCount: 4,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  } satisfies SimpleRouteJson

  expect(getRoutingZLayers(srj)).toEqual([0, 1, 2, 3])
  expect(normalizeSrjRoutingLayers(srj)).toBe(srj)
})

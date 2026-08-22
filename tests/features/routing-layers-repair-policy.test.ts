import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { canUseUnrestrictedLayerMoves } from "lib/utils/routing-layer-constraints"

test("layer-changing repairs run only when every board layer is routable", () => {
  const input = {
    layerCount: 4,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [],
  } satisfies SimpleRouteJson

  expect(canUseUnrestrictedLayerMoves(input)).toBe(true)
  expect(
    canUseUnrestrictedLayerMoves({
      ...input,
      routingLayers: ["top", "inner1", "inner2", "bottom"],
    }),
  ).toBe(true)
  expect(
    canUseUnrestrictedLayerMoves({
      ...input,
      routingLayers: ["top", "bottom"],
    }),
  ).toBe(false)
})

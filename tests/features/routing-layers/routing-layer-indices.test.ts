import { expect, test } from "bun:test"
import { getRoutingLayerIndices } from "lib/utils/getRoutingLayerIndices"

test("preserves physical layer indices when routing layers exclude a plane", () => {
  expect(getRoutingLayerIndices({ layerCount: 4 })).toEqual([0, 1, 2, 3])
  expect(
    getRoutingLayerIndices({
      layerCount: 4,
      routingLayers: ["bottom", "inner2", "top"],
    }),
  ).toEqual([0, 2, 3])
  for (const routingLayers of [[], ["inner3"], ["top", "inner4"]]) {
    expect(() =>
      getRoutingLayerIndices({ layerCount: 4, routingLayers }),
    ).toThrow()
  }
})

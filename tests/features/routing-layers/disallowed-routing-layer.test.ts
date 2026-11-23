import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "lib/types"
import { getDisallowedRoutingLayer } from "lib/utils/getDisallowedRoutingLayer"

test("checks copper up to and after a through-via while allowing the barrel to cross planes", () => {
  const surfaceLayers = new Set(["top", "bottom"])
  const route: SimplifiedPcbTrace["route"] = [
    { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.12 },
    {
      route_type: "via",
      x: 1,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      layers: ["top", "inner1", "inner2", "bottom"],
    },
    { route_type: "wire", x: 2, y: 0, layer: "bottom", width: 0.12 },
  ]
  expect(getDisallowedRoutingLayer(route, surfaceLayers)).toBeUndefined()
  route[2] = { route_type: "wire", x: 2, y: 0, layer: "inner2", width: 0.12 }
  expect(getDisallowedRoutingLayer(route, surfaceLayers)).toBe("inner2")
})

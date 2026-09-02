import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "lib/types"
import { getViaLayerNames } from "lib/utils/getViaLayerNames"

type ViaRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "via" }
>

test("explicit via layers preserve through-via copper beyond the routing transition", () => {
  const throughVia: ViaRoutePoint = {
    route_type: "via",
    x: 4.7158,
    y: 21.3872,
    from_layer: "top",
    to_layer: "inner2",
    layers: ["top", "inner1", "inner2", "bottom"],
  }
  const blindVia: ViaRoutePoint = {
    route_type: "via",
    x: 0,
    y: 0,
    from_layer: "top",
    to_layer: "inner2",
  }

  expect(getViaLayerNames({ via: throughVia, layerCount: 4 })).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])
  expect(getViaLayerNames({ via: blindVia, layerCount: 4 })).toEqual([
    "top",
    "inner1",
    "inner2",
  ])
})

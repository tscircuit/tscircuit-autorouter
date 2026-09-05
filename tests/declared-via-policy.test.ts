import { expect, test } from "bun:test"
import type { SimplifiedPcbTraces } from "lib/types"
import { applyViaLayerPolicyToTraces } from "lib/utils/applyViaLayerPolicyToTraces"
import { getDeclaredViaLayers } from "lib/utils/getDeclaredViaLayers"

test("explicit via policy adds geometry without mutating or reinterpreting legacy routes", () => {
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "power",
      connection_name: "power",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner2",
        },
      ],
    },
  ]
  const original = structuredClone(traces)
  const legacy = { layerCount: 4 }
  expect(applyViaLayerPolicyToTraces(traces, legacy)).toBe(traces)
  for (const allowBlindAndBuriedVias of [false, true]) {
    const result = applyViaLayerPolicyToTraces(traces, {
      ...legacy,
      allowBlindAndBuriedVias,
    })
    const via = result[0]!.route[0]!
    expect(via.route_type === "via" && via.layers).toEqual(
      allowBlindAndBuriedVias
        ? ["top", "inner1", "inner2"]
        : ["top", "inner1", "inner2", "bottom"],
    )
  }
  expect(traces).toEqual(original)
  expect(
    getDeclaredViaLayers({
      layerCount: 4,
      fromLayer: "top",
      toLayer: "inner2",
    }),
  ).toEqual(["top", "inner2"])
  expect(
    getDeclaredViaLayers({
      layerCount: 6,
      fromLayer: "inner3",
      toLayer: "inner1",
      allowBlindAndBuriedVias: true,
    }),
  ).toEqual(["inner1", "inner2", "inner3"])
})

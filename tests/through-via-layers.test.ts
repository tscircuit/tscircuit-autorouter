import { expect, test } from "bun:test"
import type { SimplifiedPcbTraces } from "lib/types"
import { addThroughViaLayersToTraces } from "lib/utils/addThroughViaLayersToTraces"
import { getViaLayers } from "high-density-repair03/lib"

test("through-via generation supplies full layers and endpoint vias use inclusive spans", () => {
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
  const board = { layerCount: 4 }
  expect(addThroughViaLayersToTraces(traces, board)).toBe(traces)
  for (const allowBlindAndBuriedVias of [false, true]) {
    const result = addThroughViaLayersToTraces(traces, {
      ...board,
      allowBlindAndBuriedVias,
    })
    const via = result[0]!.route[0]!
    if (via.route_type !== "via") throw new Error("Expected a via")
    expect(getViaLayers(via, board.layerCount)).toEqual(
      allowBlindAndBuriedVias
        ? ["top", "inner1", "inner2"]
        : ["top", "inner1", "inner2", "bottom"],
    )
  }
  expect(traces).toEqual(original)
  expect(getViaLayers({ from_layer: "top", to_layer: "inner2" }, 4)).toEqual([
    "top",
    "inner1",
    "inner2",
  ])
})

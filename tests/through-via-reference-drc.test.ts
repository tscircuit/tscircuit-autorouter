import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

test("reference DRC checks a through-via on every board layer", () => {
  const srj = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } satisfies SimpleRouteJson
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "via_trace",
      connection_name: "via_net",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_trace",
      connection_name: "signal_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]

  const circuitJson = convertToCircuitJson(srj, traces)

  expect(circuitJson.find((element) => element.type === "pcb_via")?.layers).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])
  expect(
    getDrcErrors(circuitJson, { includeTraceContinuity: false }).errors.some(
      (error) => error.type === "pcb_trace_error",
    ),
  ).toBe(true)
})

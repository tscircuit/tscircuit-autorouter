import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { materializeAndValidateGeneratedThroughVias } from "lib/utils/materializeAndValidateGeneratedThroughVias"

test("native output validation includes preserved input copper", () => {
  const preservedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preserved-inner-wire",
    connection_name: "OTHER",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.2, layer: "inner2" },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "inner2" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    minTraceWidth: 0.15,
    minViaDiameter: 0.5,
    obstacles: [],
    connections: [
      { name: "SIG", pointsToConnect: [] },
      { name: "OTHER", pointsToConnect: [] },
    ],
    traces: [preservedTrace],
  }
  const generatedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "generated-via",
    connection_name: "SIG",
    route: [
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.5,
      },
    ],
  }

  expect(() =>
    materializeAndValidateGeneratedThroughVias({
      srj,
      outputTraces: [generatedTrace],
    }),
  ).toThrow("collides with trace preserved-inner-wire on inner2")
})

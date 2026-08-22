import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { materializeAndValidateGeneratedThroughVias } from "lib/utils/materializeAndValidateGeneratedThroughVias"

test("through vias reject copper inside a rotated intermediate-layer obstacle", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    minTraceWidth: 0.15,
    minViaDiameter: 0.5,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 4,
        height: 0.4,
        ccwRotationDegrees: 45,
        layers: ["inner2"],
        connectedTo: [],
        obstacleId: "rotated-inner2-keepout",
      },
    ],
    connections: [{ name: "SIG", pointsToConnect: [] }],
  }
  const outputTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "generated-via",
    connection_name: "SIG",
    route: [
      {
        route_type: "via",
        x: 1,
        y: 1,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.5,
      },
    ],
  }

  expect(() =>
    materializeAndValidateGeneratedThroughVias({
      srj,
      outputTraces: [outputTrace],
    }),
  ).toThrow("collides with obstacle rotated-inner2-keepout on inner2")
})

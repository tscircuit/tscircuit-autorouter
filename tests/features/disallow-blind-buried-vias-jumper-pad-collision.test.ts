import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { materializeAndValidateGeneratedThroughVias } from "lib/utils/materializeAndValidateGeneratedThroughVias"

test("through vias collide with unrelated route and authored jumper pads", () => {
  const viaTrace: SimplifiedPcbTrace = {
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
  const jumperTrace = (connectionName: string): SimplifiedPcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: `jumper-${connectionName}`,
    connection_name: connectionName,
    route: [
      {
        route_type: "jumper",
        start: { x: 0, y: 0 },
        end: { x: 1.65, y: 0 },
        footprint: "0603",
        layer: "inner2",
      },
    ],
  })
  const srj: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -2, maxX: 3, minY: -2, maxY: 2 },
    minTraceWidth: 0.15,
    minViaDiameter: 0.5,
    obstacles: [],
    connections: [
      { name: "SIG", pointsToConnect: [] },
      { name: "OTHER", pointsToConnect: [] },
    ],
  }

  expect(() =>
    materializeAndValidateGeneratedThroughVias({
      srj,
      outputTraces: [viaTrace, jumperTrace("OTHER")],
    }),
  ).toThrow("collides with jumper pad on trace jumper-OTHER on inner2")

  expect(() =>
    materializeAndValidateGeneratedThroughVias({
      srj: {
        ...srj,
        jumpers: [
          {
            jumper_footprint: "0603",
            center: { x: 0.825, y: 0 },
            orientation: "horizontal",
            width: 1.65,
            height: 0.95,
            pads: [
              {
                type: "rect",
                center: { x: 0, y: 0 },
                width: 0.8,
                height: 0.95,
                layers: ["inner2"],
                connectedTo: ["OTHER"],
                obstacleId: "authored-jumper-start-pad",
              },
            ],
          },
        ],
      },
      outputTraces: [viaTrace],
    }),
  ).toThrow("collides with obstacle authored-jumper-start-pad on inner2")

  expect(
    materializeAndValidateGeneratedThroughVias({
      srj,
      outputTraces: [viaTrace, jumperTrace("SIG")],
    })[0]!.route[0],
  ).toMatchObject({ from_layer: "top", to_layer: "bottom" })
})

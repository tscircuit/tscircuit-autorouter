import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "high-density-repair03/lib/types"

test("installed repair03 uses declared circular SMT pad edges for trace and via clearance", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.089,
    minViaDiameter: 0.28,
    minTraceToPadEdgeClearance: 0.089,
    minViaEdgeToPadEdgeClearance: 0.089,
    connections: [{ name: "signal", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.23,
        height: 0.23,
        connectedTo: ["pcb_smtpad_ball"],
      },
    ],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: 0.14, y: 0.22, width: 0.089, layer: "top" },
        { route_type: "wire", x: 0.22, y: 0.14, width: 0.089, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "via",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: 0.25, y: 0.25, width: 0.089, layer: "top" },
        {
          route_type: "via",
          x: 0.25,
          y: 0.25,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.28,
        },
        { route_type: "wire", x: 0.25, y: 0.25, width: 0.089, layer: "bottom" },
      ],
    },
  ]
  for (const rotation of [undefined, 0, 45]) {
    srj.obstacles[0]!.ccwRotationDegrees = rotation
    expect(
      new AutoroutingDrcEngine(srj, {
        traceClearance: 0.089,
        viaToPadClearance: 0.089,
      }).evaluate(traces).errors,
    ).toEqual([])
  }
  srj.obstacles[0]!.shape = undefined
  srj.obstacles[0]!.ccwRotationDegrees = undefined
  expect(
    new AutoroutingDrcEngine(srj, {
      traceClearance: 0.089,
      viaToPadClearance: 0.089,
    }).evaluate(traces).errors,
  ).toHaveLength(2)
  srj.obstacles[0]!.shape = "circle"
  srj.obstacles[0]!.width = 0.3
  srj.obstacles[0]!.height = 0.3
  expect(
    new AutoroutingDrcEngine(srj, {
      traceClearance: 0.089,
      viaToPadClearance: 0.089,
    }).evaluate(traces).errors,
  ).toHaveLength(2)
})

import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSimplifiedPcbTraceConnectionLengthOffsets } from "lib/solvers/getSimplifiedPcbTraceConnectionLengthOffsets"
import type { SimplifiedPcbTraces } from "lib/types"

test("sums immutable routed copper by logical connection", () => {
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "a-first",
      connection_name: "A-left-breakout",
      connectsTo: ["A-left-exit"],
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 3, y: 4, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 3,
          y: 4,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        { route_type: "wire", x: 3, y: 4, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 6, y: 8, width: 0.1, layer: "bottom" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "a-second",
      connection_name: "A-right-breakout",
      connectsTo: ["A-right-exit"],
      route: [
        { route_type: "wire", x: 10, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 12, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "b",
      connection_name: "B",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 3, width: 0.1, layer: "top" },
      ],
    },
  ]
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["A", "A-left-breakout", "A-left-exit"],
    ["A", "A-right-breakout", "A-right-exit"],
    ["B"],
  ])

  const offsets = getSimplifiedPcbTraceConnectionLengthOffsets(traces, connMap)
  expect(offsets.A).toBe(12)
  expect(offsets.B).toBe(3)
  expect(offsets["A-left-breakout"]).toBe(12)
  expect(offsets["A-right-breakout"]).toBe(12)
})

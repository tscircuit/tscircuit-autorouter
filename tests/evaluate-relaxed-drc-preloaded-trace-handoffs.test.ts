import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC accepts net-level endpoints on same-net preloaded copper", () => {
  const preloadedTraces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "left_fanout",
      connection_name: "breakout:left_handoff",
      connectsTo: ["left_handoff"],
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "right_fanout",
      connection_name: "breakout:right_handoff",
      connectsTo: ["right_handoff"],
      route: [
        { route_type: "wire", x: 3, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 4, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "dq",
        pointsToConnect: [
          { x: 1, y: 0, layer: "top", pointId: "left_handoff" },
          { x: 2, y: 0, layer: "top", pointId: "right_handoff" },
        ],
      },
    ],
    traces: preloadedTraces,
  }
  const globalTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "global_trace",
    connection_name: "dq",
    connectsTo: ["left_handoff", "right_handoff"],
    route: [
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
    ],
  }

  const { errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces: [globalTrace],
  })
  const globalTraceErrors = errors.filter(
    (error) => "pcb_trace_id" in error && error.pcb_trace_id === "global_trace",
  )

  expect(globalTraceErrors).toEqual([])
})

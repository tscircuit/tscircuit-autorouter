import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC connects a preloaded fanout trace to its own pad", () => {
  const fanoutTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fanout:breakout:point_0",
    connection_name: "breakout:point_0",
    connectsTo: ["breakout:point_0", "pcb_port_0", "pcb_port_0"],
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "pcb_port_0",
      },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_0", "pcb_port_0"],
      },
    ],
    connections: [
      {
        name: "routed_connection",
        pointsToConnect: [
          {
            x: 1,
            y: 0,
            layer: "top",
            pointId: "breakout:point_0",
          },
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
        ],
      },
    ],
    traces: [fanoutTrace],
  }
  const routedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "routed_trace",
    connection_name: "routed_connection",
    route: [
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "wire",
        x: 2,
        y: 0,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "pcb_port_1",
      },
    ],
  }

  const { errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces: [routedTrace],
  })
  expect(errors).toHaveLength(0)
})

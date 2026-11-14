import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("the point-pair MST adapts canonical initially connected groups", () => {
  const srj = {
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "port1" },
          { x: 1, y: 0, layer: "top", pointId: "port2" },
          { x: 2, y: 0, layer: "top", pointId: "port3" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace1",
        connection_name: "net1",
        connectsTo: ["port1", "port2"],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "trace2",
        connection_name: "net1",
        connectsTo: ["port2", "port3"],
        route: [],
      },
    ],
  } satisfies SimpleRouteJson

  const solver = new NetToPointPairsSolver(
    structuredClone(srj),
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()

  expect(solver.newConnections).toHaveLength(0)
})

test("NetToPointPairsSolver retains disconnected escape traces that share a source_trace_id in connectsTo", () => {
  const srj = {
    bounds: { minX: -45, maxX: 45, minY: -25, maxY: 25 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "source_trace_337",
        source_trace_id: "source_trace_337",
        nominalTraceWidth: 0.1,
        pointsToConnect: [
          {
            x: -1.825,
            y: -2.275,
            layer: "bottom",
            pointId: "pcb_breakout_point_96",
          },
          {
            x: 9.57,
            y: -7.63,
            layer: "bottom",
            pointId: "pcb_breakout_point_333",
          },
        ],
      },
      {
        name: "source_trace_338",
        source_trace_id: "source_trace_338",
        nominalTraceWidth: 0.1,
        pointsToConnect: [
          {
            x: -1.175,
            y: -2.275,
            layer: "bottom",
            pointId: "pcb_breakout_point_97",
          },
          {
            x: 9.57,
            y: -6.83,
            layer: "bottom",
            pointId: "pcb_breakout_point_334",
          },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "saved_fanout_pcb_group_2_96",
        connection_name: "breakout:pcb_breakout_point_96",
        connectsTo: [
          "source_trace_337",
          "pcb_port_502",
          "pcb_breakout_point_96",
        ],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "saved_fanout_pcb_group_2_97",
        connection_name: "breakout:pcb_breakout_point_97",
        connectsTo: [
          "source_trace_338",
          "pcb_port_503",
          "pcb_breakout_point_97",
        ],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "saved_fanout_pcb_group_3_58",
        connection_name: "breakout:pcb_breakout_point_333",
        connectsTo: [
          "source_trace_337",
          "pcb_port_865",
          "pcb_breakout_point_333",
        ],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "saved_fanout_pcb_group_3_59",
        connection_name: "breakout:pcb_breakout_point_334",
        connectsTo: [
          "source_trace_338",
          "pcb_port_866",
          "pcb_breakout_point_334",
        ],
        route: [],
      },
    ],
  } satisfies SimpleRouteJson

  const initiallyConnectedMap = getInitiallyConnectedMapFromSimpleRouteJson(srj)
  const solver = new NetToPointPairsSolver(
    structuredClone(srj),
    {},
    initiallyConnectedMap,
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.newConnections).toHaveLength(2)
})

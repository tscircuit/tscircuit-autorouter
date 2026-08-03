import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import {
  areIdsInitiallyConnected,
  getInitiallyConnectedMapFromSimpleRouteJson,
} from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("initially connected map joins overlapping trace metadata without joining the entire net", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "port1" },
          { x: 0, y: 0, layer: "top", pointId: "port2" },
          { x: 1, y: 0, layer: "top", pointId: "port3" },
          { x: 2, y: 0, layer: "top", pointId: "unrouted_port" },
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

  const initiallyConnectedMap = getInitiallyConnectedMapFromSimpleRouteJson(srj)

  expect(initiallyConnectedMap.areIdsConnected("port1", "port3")).toBeTrue()
  expect(
    initiallyConnectedMap.areIdsConnected("port1", "unrouted_port"),
  ).toBeFalse()
  expect(
    areIdsInitiallyConnected(
      initiallyConnectedMap,
      "unrouted_port",
      "unrouted_port",
    ),
  ).toBeFalse()
})

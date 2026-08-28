import { describe, expect, test } from "bun:test"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"

describe("getConnectivityMapFromSimpleRouteJson", () => {
  test("connects a preloaded trace to a route endpoint at the same position and layer", () => {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.2,
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
      connections: [
        {
          name: "global_net",
          pointsToConnect: [
            { x: 10, y: 5, layer: "top", pointId: "breakout_point" },
          ],
        },
        {
          name: "different_layer_net",
          pointsToConnect: [
            { x: 10, y: 5, layer: "bottom", pointId: "bottom_point" },
          ],
        },
      ],
      obstacles: [],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "fanout_trace",
          connection_name: "local_fanout",
          route: [
            {
              route_type: "wire",
              x: 5,
              y: 5,
              width: 0.2,
              layer: "top",
            },
            {
              route_type: "wire",
              x: 10,
              y: 5,
              width: 0.2,
              layer: "top",
            },
          ],
        },
      ],
    }

    const connMap = getConnectivityMapFromSimpleRouteJson(srj)

    expect(connMap.areIdsConnected("global_net", "local_fanout")).toBe(true)
    expect(connMap.areIdsConnected("global_net", "fanout_trace")).toBe(true)
    expect(connMap.areIdsConnected("different_layer_net", "fanout_trace")).toBe(
      false,
    )
  })

  test("includes off-board obstacle connections", () => {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.2,
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 1, y: 1 },
          width: 1,
          height: 1,
          connectedTo: ["obstacle_a"],
          offBoardConnectsTo: ["obstacle_b"],
        },
        {
          type: "rect",
          layers: ["top"],
          center: { x: 2, y: 2 },
          width: 1,
          height: 1,
          connectedTo: ["obstacle_b"],
        },
      ],
    }

    const connMap = getConnectivityMapFromSimpleRouteJson(srj)

    expect(connMap.areIdsConnected("obstacle_a", "obstacle_b")).toBe(true)
  })
})

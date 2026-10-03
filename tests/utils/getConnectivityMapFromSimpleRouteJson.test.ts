import { describe, expect, test } from "bun:test"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"

describe("getConnectivityMapFromSimpleRouteJson", () => {
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

  test("merges transitive connection, obstacle, and trace groups", () => {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.2,
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
      connections: [
        {
          name: "connection_a",
          pointsToConnect: [
            {
              x: 1,
              y: 1,
              layers: ["top"],
              pointId: "terminal_a",
              pcb_port_id: "pcb_port_a",
            },
          ],
          __rootConnectionNames: ["root_a"],
          __netConnectionName: "net_a",
        },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 1, y: 1 },
          width: 1,
          height: 1,
          connectedTo: ["pcb_port_a"],
          offBoardConnectsTo: ["offboard_a"],
        },
      ],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "trace_a",
          connection_name: "connection_a",
          route: [],
          connectsTo: ["offboard_a"],
        },
      ],
    }

    const connMap = getConnectivityMapFromSimpleRouteJson(srj)

    for (const connectedId of [
      "root_a",
      "net_a",
      "terminal_a",
      "pcb_port_a",
      "offboard_a",
      "trace_a",
    ]) {
      expect(connMap.areIdsConnected("connection_a", connectedId)).toBe(true)
    }
  })
})

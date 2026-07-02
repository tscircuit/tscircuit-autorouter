import { describe, expect, test } from "bun:test"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"

describe("getConnectivityMapFromSimpleRouteJson", () => {
  test("includes obstacle-derived connections", () => {
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
          obstacleId: "connected_rotated_pad",
          type: "rect",
          layers: ["top"],
          center: { x: 3, y: 3 },
          width: 1,
          height: 1,
          connectedTo: ["net_a"],
        },
        {
          obstacleId: "connected_rotated_pad_approx_1",
          type: "rect",
          layers: ["top"],
          center: { x: 4, y: 4 },
          width: 1,
          height: 1,
          connectedTo: ["connected_rotated_pad"],
        },
      ],
    }

    const connMap = getConnectivityMapFromSimpleRouteJson(srj)

    expect(connMap.areIdsConnected("obstacle_a", "obstacle_b")).toBe(true)
    expect(
      connMap.areIdsConnected(
        "connected_rotated_pad_approx_1",
        "connected_rotated_pad",
      ),
    ).toBe(true)
    expect(
      connMap.areIdsConnected("connected_rotated_pad_approx_1", "net_a"),
    ).toBe(true)
  })
})

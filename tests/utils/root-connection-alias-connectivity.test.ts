import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a connection is connected to every root connection alias", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "connection_a__connection_b",
        __rootConnectionNames: ["connection_a", "connection_b"],
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 1, layer: "top" },
        ],
      },
    ],
  }

  const connMap = getConnectivityMapFromSimpleRouteJson(srj)

  expect(
    connMap.areIdsConnected("connection_a__connection_b", "connection_a"),
  ).toBe(true)
  expect(
    connMap.areIdsConnected("connection_a__connection_b", "connection_b"),
  ).toBe(true)
})

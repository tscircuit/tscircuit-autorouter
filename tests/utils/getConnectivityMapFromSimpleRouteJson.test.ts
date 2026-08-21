import { describe, expect, test } from "bun:test";
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson";
import type { SimpleRouteJson } from "lib/types";

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
    };

    const connMap = getConnectivityMapFromSimpleRouteJson(srj);

    expect(connMap.areIdsConnected("obstacle_a", "obstacle_b")).toBe(true);
  });
});

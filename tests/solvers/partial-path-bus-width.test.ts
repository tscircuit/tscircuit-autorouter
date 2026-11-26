import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("keeps the bus width on a branch outside the written path", () => {
  for (const pathWidth of [undefined, 0.8]) {
    const input: SimpleRouteJson = {
      bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      buses: [{ busId: "bus", connectionNames: ["data"], traceWidth: 0.4 }],
      connections: [
        {
          name: "data",
          pointsToConnect: [
            { pointId: "A", x: 0, y: 0, layer: "top" },
            { pointId: "B", x: 3, y: 0, layer: "top" },
            { pointId: "C", x: 4, y: 0, layer: "top" },
          ],
          path: ["A", "B"],
          nominalTraceWidth: pathWidth,
        },
      ],
    }
    const solver = new NetToPointPairsSolver(
      input,
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(input),
    )
    solver.solve()
    const widths = Object.fromEntries(
      solver.newConnections.map(({ pointsToConnect, nominalTraceWidth }) => [
        pointsToConnect
          .map((point) => point.pointId)
          .sort()
          .join("-"),
        nominalTraceWidth,
      ]),
    )
    expect(widths).toEqual({ "A-B": pathWidth ?? 0.4, "B-C": 0.4 })
  }
})

import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

// The trace is written A -> B -> C. The nearest-neighbor tree would link
// A-C and C-B instead. TAP shares the net through A but is not on the path.
const srj: SimpleRouteJson = {
  bounds: { minX: -1, maxX: 5, minY: -2, maxY: 5 },
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [],
  connections: [
    {
      name: "trace_abc",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: "A" },
        { x: 4, y: 4, layer: "top", pointId: "B" },
        { x: 0, y: 1, layer: "top", pointId: "C" },
      ],
      path: ["A", "B", "C"],
    },
    {
      name: "tap",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: "A" },
        { x: 0, y: -1, layer: "top", pointId: "TAP" },
      ],
    },
  ],
}

for (const Solver of [
  NetToPointPairsSolver,
  NetToPointPairsSolver2_OffBoardConnection,
]) {
  test.failing(`${Solver.name} links trace path points in order`, async () => {
    const solver = new Solver(
      structuredClone(srj),
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(srj),
    )
    solver.solve()

    const pointPairs = solver.newConnections.map((connection) =>
      connection.pointsToConnect.map((point) => point.pointId).join("->"),
    )
    expect(pointPairs).toContain("A->B")
    expect(pointPairs).toContain("B->C")
    expect(pointPairs).toHaveLength(3)
  })
}

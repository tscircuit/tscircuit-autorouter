import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("declared path terminals retain their identity when a closer off-board equivalent exists", () => {
  const a = { x: 0, y: 0, layer: "top", pointId: "A" }
  const b = { x: 4, y: 4, layer: "top", pointId: "B" }
  const c = { x: 2, y: 0, layer: "top", pointId: "C" }
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 6, minY: -1, maxY: 6 },
    obstacles: [],
    connections: [
      { name: "signal", path: ["A", "B", "C"], pointsToConnect: [c, a, b] },
      {
        name: "offboard",
        isOffBoard: true,
        pointsToConnect: [
          b,
          { x: 0.1, y: 0, layer: "top", pointId: "B_equivalent" },
        ],
      },
    ],
  }
  for (const pointsToConnect of [
    [c, a, b],
    [b, a],
  ]) {
    input.connections[0]!.pointsToConnect = pointsToConnect
    input.connections[0]!.path =
      pointsToConnect.length === 2 ? ["A", "B"] : ["A", "B", "C"]
    const solver = new NetToPointPairsSolver2_OffBoardConnection(
      input,
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(input),
    )
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(
      solver.newConnections.map(({ pointsToConnect }) =>
        pointsToConnect.map((point) => point.pointId),
      ),
    ).toEqual(
      pointsToConnect.length === 2
        ? [["A", "B"]]
        : [
            ["A", "B"],
            ["B", "C"],
          ],
    )
  }
})

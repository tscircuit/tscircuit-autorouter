import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"

test("off-board endpoint substitution preserves original endpoint provenance", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, maxX: 20, minY: 0, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "original_on_board",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "A" },
          { x: 20, y: 0, layer: "top", pointId: "B" },
        ],
      },
      {
        name: "off_board_a",
        isOffBoard: true,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "A" },
          { x: 9, y: 1, layer: "top", pointId: "A_prime" },
        ],
      },
      {
        name: "off_board_b",
        isOffBoard: true,
        pointsToConnect: [
          { x: 20, y: 0, layer: "top", pointId: "B" },
          { x: 11, y: 1, layer: "top", pointId: "B_prime" },
        ],
      },
    ],
  }
  const solver = new NetToPointPairsSolver2_OffBoardConnection(srj)
  solver.solve()

  expect(solver.newConnections).toHaveLength(1)
  expect(
    solver.newConnections[0]?.pointsToConnect.map((point) => point.pointId),
  ).toEqual(["A_prime", "B_prime"])
  expect(
    solver.newConnections[0]?.__originalSrjConnectionName,
  ).toBe("original_on_board")
})

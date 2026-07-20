import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"

test("overlapping external point groups are treated as one connected component", () => {
  const pointsToConnect = [
    { x: 0, y: 0, layer: "top", pointId: "A" },
    { x: 1, y: 0, layer: "top", pointId: "B" },
    { x: 2, y: 0, layer: "top", pointId: "C" },
    { x: 3, y: 0, layer: "top", pointId: "D" },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 4, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "shared_net",
        pointsToConnect,
        externallyConnectedPointIds: [
          ["A", "B"],
          ["B", "C"],
        ],
      },
    ],
  }

  const solver = new NetToPointPairsSolver(srj)
  solver.solve()

  expect(solver.newConnections).toHaveLength(1)
  expect(
    solver.newConnections[0]!.pointsToConnect.map((point) => point.pointId),
  ).toContain("D")
  expect(
    solver.newConnections[0]!.pointsToConnect.map(
      (point) => point.pointId,
    ).filter((pointId) => pointId !== "D"),
  ).toHaveLength(1)
})

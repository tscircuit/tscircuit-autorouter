import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"

// Regression test for https://github.com/tscircuit/tscircuit-autorouter/issues/1721
// Same scenario as net-to-point-pairs-trace-widths.test.ts but for the
// off-board-aware solver used by the default pipeline: merged nets must keep a
// per-edge nominalTraceWidth on the MST pair connections.
test("NetToPointPairsSolver2_OffBoardConnection keeps per-edge nominalTraceWidth for merged nets", () => {
  const srj = {
    bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "wide_trace",
        nominalTraceWidth: 0.8,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "p0" },
          { x: 1, y: 0, layer: "top", pointId: "p1" },
        ],
      },
      {
        name: "narrow_trace",
        nominalTraceWidth: 0.25,
        pointsToConnect: [
          { x: 1, y: 0, layer: "top", pointId: "p1" },
          { x: 2, y: 0, layer: "top", pointId: "p2" },
        ],
      },
    ],
  } satisfies SimpleRouteJson

  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    structuredClone(srj),
  )
  solver.solve()

  const pairConnections = solver.getNewSimpleRouteJson().connections
  expect(pairConnections).toHaveLength(2)

  const touchesX = (points: ConnectionPoint[], x: number): boolean =>
    points.some((point) => point.x === x)

  const wideEdge = pairConnections.find((connection) =>
    touchesX(connection.pointsToConnect, 0),
  )
  const narrowEdge = pairConnections.find((connection) =>
    touchesX(connection.pointsToConnect, 2),
  )

  expect(wideEdge?.nominalTraceWidth).toBe(0.8)
  expect(narrowEdge?.nominalTraceWidth).toBe(0.25)
})

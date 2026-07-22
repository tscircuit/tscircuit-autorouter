import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"

// Regression test for https://github.com/tscircuit/tscircuit-autorouter/issues/1721
// Two connections with different nominalTraceWidths share a point, so they are
// merged into one net. Each MST pair connection must keep the width of the
// original connection its edge belongs to, instead of inheriting the first
// connection's width (or no width at all).
test("NetToPointPairsSolver keeps per-edge nominalTraceWidth for merged nets", () => {
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
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "narrow_trace",
        nominalTraceWidth: 0.25,
        pointsToConnect: [
          { x: 1, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
  } satisfies SimpleRouteJson

  const solver = new NetToPointPairsSolver(structuredClone(srj))
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

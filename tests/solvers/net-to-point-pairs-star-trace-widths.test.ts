import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"

// Regression test for https://github.com/tscircuit/tscircuit-autorouter/issues/1721
// A wide (0.8) and a narrow (0.25) connection share a hub point, and the MST
// reroutes the wide connection's path THROUGH the narrow connection's endpoint
// (hub -> narrow -> wide is shorter than hub -> wide directly). Every edge on
// the wide connection's path must still be 0.8 wide, even the edge whose
// endpoints belong to the narrow connection.
test("NetToPointPairsSolver widens through-path MST edges to the widest crossing connection", () => {
  const srj = {
    bounds: { minX: -1, maxX: 3, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "narrow_stub",
        nominalTraceWidth: 0.25,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" }, // hub
          { x: 1, y: 0, layer: "top" }, // narrow endpoint, on the way to wide
        ],
      },
      {
        name: "wide_trace",
        nominalTraceWidth: 0.8,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" }, // hub
          { x: 2, y: 0, layer: "top" }, // wide endpoint
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

  // MST is hub(0,0) - narrow(1,0) - wide(2,0). The wide connection's current
  // flows hub -> narrow -> wide, so BOTH edges must be 0.8.
  const hubToNarrowEdge = pairConnections.find((connection) =>
    touchesX(connection.pointsToConnect, 0),
  )
  const narrowToWideEdge = pairConnections.find((connection) =>
    touchesX(connection.pointsToConnect, 2),
  )

  expect(hubToNarrowEdge?.nominalTraceWidth).toBe(0.8)
  expect(narrowToWideEdge?.nominalTraceWidth).toBe(0.8)
})

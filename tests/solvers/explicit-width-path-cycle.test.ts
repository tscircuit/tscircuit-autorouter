import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("keeps each requested width edge of a loop and emits a repeated hop once", () => {
  const a = { pointId: "A", x: 0, y: 0, layer: "top" }
  const b = { pointId: "B", x: 4, y: 0, layer: "top" }
  const c = { pointId: "C", x: 2, y: 1, layer: "top" }
  const input: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "chain",
        path: ["A", "B", "C"],
        nominalTraceWidth: 0.2,
        pointsToConnect: [a, b, c],
      },
      {
        name: "return",
        path: ["C", "A"],
        nominalTraceWidth: 0.4,
        pointsToConnect: [c, a],
      },
      {
        name: "shared",
        path: ["B", "A"],
        width: 0.8,
        pointsToConnect: [b, a],
      },
    ],
  }
  const solver = new NetToPointPairsSolver(
    input,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(input),
  )
  solver.solve()
  const pairs = solver.newConnections.map((connection) => [
    connection.pointsToConnect
      .map((point) => point.pointId)
      .sort()
      .join("–"),
    connection.nominalTraceWidth,
  ])
  expect(pairs.sort()).toEqual([
    ["A–B", 0.8],
    ["A–C", 0.4],
    ["B–C", 0.2],
  ])
})

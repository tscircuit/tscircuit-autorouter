import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("retains the declared inline sections when a shorter net tree could bypass them", () => {
  const [positive, negative] = ["P", "N"].map((name, polarity) => ({
    name,
    pointsToConnect: [
      { x: 0, y: 0, pad: "A" },
      { x: 4, y: 4, pad: "B" },
      { x: 2, y: 0, pad: "C" },
    ].map(({ x, y, pad }) => ({
      x,
      y: y + polarity * 0.6,
      pointId: `${name}.${pad}`,
      layer: "top",
    })),
  }))
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 7, minY: -1, maxY: 7 },
    obstacles: [],
    connections: [
      positive!,
      negative!,
      {
        name: "TEST_POINT",
        pointsToConnect: [
          positive!.pointsToConnect[1]!,
          { x: 5, y: 5, pointId: "TP", layer: "top" },
        ],
      },
    ],
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance: 0.05 }],
  }
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    input,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(input),
    input.connections,
  )
  solver.solve()

  const routedLinks = solver.newConnections.map((connection) =>
    connection.pointsToConnect
      .map((point) => point.pointId)
      .sort()
      .join("/"),
  )
  expect(routedLinks.sort()).toEqual([
    "N.A/N.B",
    "N.B/N.C",
    "P.A/P.B",
    "P.B/P.C",
    "P.B/TP",
  ])
})

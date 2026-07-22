import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

test("original provenance width selection uses connection, SRJ, then minimum widths", () => {
  const createCrossConnectionGroup = (
    firstName: string,
    firstWidth: number | undefined,
    secondName: string,
    secondWidth: number | undefined,
  ): SimpleRouteConnection[] => [
    {
      name: firstName,
      nominalTraceWidth: firstWidth,
      pointsToConnect: [
        { x: 100, y: 0, layer: "top", pointId: `${firstName}_shared` },
        { x: 0, y: 0, layer: "top", pointId: `${firstName}_left` },
      ],
    },
    {
      name: secondName,
      nominalTraceWidth: secondWidth,
      pointsToConnect: [
        { x: 100, y: 0, layer: "top", pointId: `${firstName}_shared` },
        { x: 1, y: 0, layer: "top", pointId: `${secondName}_right` },
      ],
    },
  ]
  const solveCrossPair = (
    connections: SimpleRouteConnection[],
    nominalTraceWidth?: number,
  ): SimpleRouteConnection => {
    const srj: SimpleRouteJson = {
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 1 },
      layerCount: 2,
      minTraceWidth: 0.15,
      nominalTraceWidth,
      obstacles: [],
      connections,
    }
    const solver = new NetToPointPairsSolver(srj)
    solver.solve()
    const crossPair = solver.newConnections.find((connection) =>
      connection.pointsToConnect.every(
        (point) => point.x === 0 || point.x === 1,
      ),
    )
    if (!crossPair) throw new Error("Expected a global-MST cross-connection")
    return crossPair
  }

  expect(
    solveCrossPair(
      createCrossConnectionGroup("connection_width", 0.4, "srj_width", undefined),
      0.3,
    ).__originalSrjConnectionName,
  ).toBe("connection_width")
  expect(
    solveCrossPair(
      createCrossConnectionGroup("srj_width", undefined, "lower_connection", 0.2),
      0.3,
    ).__originalSrjConnectionName,
  ).toBe("srj_width")
  expect(
    solveCrossPair(
      createCrossConnectionGroup("minimum_width", undefined, "lower_connection", 0.1),
    ).__originalSrjConnectionName,
  ).toBe("minimum_width")
})

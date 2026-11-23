import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("a narrow local alias retains the net's wider nominal target in every branch", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.08,
    bounds: { minX: -1, maxX: 4, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "local_approach",
        nominalTraceWidth: 0.1,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "power_net",
        nominalTraceWidth: 0.4,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }
  for (const connections of [
    input.connections,
    input.connections.toReversed(),
  ]) {
    const srj = {
      ...input,
      connections: mergeConnections(connections, {
        nominalTraceWidth: "maximum",
      }),
    }
    const solver = new NetToPointPairsSolver(
      srj,
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(srj),
    )
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.newConnections).toHaveLength(3)
    expect(
      solver.newConnections.map((connection) => connection.nominalTraceWidth),
    ).toEqual([0.4, 0.4, 0.4])
  }
})

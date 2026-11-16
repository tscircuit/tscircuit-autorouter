import { expect, test } from "bun:test"
import {
  buildMinimumSpanningTree,
  DisjointSet,
} from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("prefer a same-layer neighbor over a slightly shorter extra via", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.45,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a" },
          { x: 0.65, y: 0, layer: "top", pointId: "b" },
          { x: 0.647763573325938, y: 0, layer: "bottom", pointId: "c" },
        ],
      },
    ],
  }
  const original = structuredClone(input)
  const points = input.connections[0]!.pointsToConnect
  const xyTree = buildMinimumSpanningTree(points)
  expect(xyTree.filter((edge) => edge.from.layer !== edge.to.layer)).toHaveLength(2)

  const solver = new NetToPointPairsSolver(
    input,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(input),
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.newConnections).toHaveLength(2)
  expect(
    solver.newConnections
      .map((pair) =>
        pair.pointsToConnect.map((point) => point.pointId).sort().join("-"),
      )
      .sort(),
  ).toEqual(["a-b", "b-c"])
  const connected = new DisjointSet(points)
  for (const pair of solver.newConnections) {
    expect(
      connected.union(pair.pointsToConnect[0]!, pair.pointsToConnect[1]!),
    ).toBe(true)
  }
  expect(connected.componentCount).toBe(1)
  expect(input).toEqual(original)
})

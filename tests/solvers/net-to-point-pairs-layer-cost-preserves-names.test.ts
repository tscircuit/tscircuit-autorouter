import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("retained point pairs keep their names and directions after reweighting", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "GND",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "A" },
          { x: 1, y: 0, layer: "top", pointId: "B" },
          { x: 1, y: 0.998, layer: "bottom", pointId: "C" },
        ],
      },
    ],
  }
  const solver = new NetToPointPairsSolver(
    input,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(input),
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(
    solver.newConnections.map(({ name, pointsToConnect }) => ({
      name,
      points: pointsToConnect.map((point) => point.pointId),
    })),
  ).toEqual([
    { name: "GND_mst0", points: ["B", "C"] },
    { name: "GND_mst1", points: ["A", "B"] },
  ])
})

import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { getConnectionPointLayers, type SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("layer preferences retain materially shorter cross-layer paths", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "GND",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "A" },
          { x: 0.4, y: 0, layer: "top", pointId: "B" },
          { x: 0.2, y: 0.15, layer: "bottom", pointId: "C" },
        ],
      },
    ],
  }
  const solver = new NetToPointPairsSolver(
    srj,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.newConnections).toHaveLength(2)
  for (const { pointsToConnect: [from, to] } of solver.newConnections) {
    expect(getConnectionPointLayers(from!)).not.toEqual(
      getConnectionPointLayers(to!),
    )
  }
  const totalLength = solver.newConnections.reduce(
    (sum, { pointsToConnect: [from, to] }) =>
      sum + Math.hypot(from!.x - to!.x, from!.y - to!.y),
    0,
  )
  expect(totalLength).toBeCloseTo(0.5)
})

import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("MST connects separated clusters larger than the old neighbor limit", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 1100, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [{
      name: "clusters",
      pointsToConnect: Array.from({ length: 22 }, (_, i) => ({
        x: i < 11 ? i : 1000 + i,
        y: 0,
        layer: "top",
        pointId: `p${i}`,
      })),
    }],
  }
  const solver = new NetToPointPairsSolver(
    srj, {}, getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.newConnections).toHaveLength(21)
  const reached = new Set(["p0"])
  for (let pass = 0; pass < 22; pass++) {
    for (const { pointsToConnect: [a, b] } of solver.newConnections) {
      if (reached.has(a.pointId!)) reached.add(b.pointId!)
      if (reached.has(b.pointId!)) reached.add(a.pointId!)
    }
  }
  expect(reached.size).toBe(22)
  const weight = solver.newConnections.reduce((sum, { pointsToConnect: [a, b] }) =>
    sum + Math.hypot(a.x - b.x, a.y - b.y), 0,
  )
  expect(weight).toBe(1021)
})

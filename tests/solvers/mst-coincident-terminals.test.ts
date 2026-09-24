import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("MST preserves distinct terminals at the same coordinates on different layers", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a" },
          { x: 0, y: 0, layer: "bottom", pointId: "b" },
          { x: 1, y: 0, layer: "top", pointId: "c" },
        ],
      },
    ],
  }
  const before = structuredClone(srj)
  const solver = new NetToPointPairsSolver(
    srj,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.newConnections).toHaveLength(2)
  const reached = new Set(["a"])
  for (let pass = 0; pass < 3; pass++) {
    for (const {
      pointsToConnect: [a, b],
    } of solver.newConnections) {
      if (reached.has(a.pointId!)) reached.add(b.pointId!)
      if (reached.has(b.pointId!)) reached.add(a.pointId!)
    }
  }
  expect([...reached].sort()).toEqual(["a", "b", "c"])
  expect(
    solver.newConnections.some(
      ({ pointsToConnect: [a, b] }) =>
        a.x === b.x && a.y === b.y && a.layer !== b.layer,
    ),
  ).toBe(true)
  expect(srj).toEqual(before)
})

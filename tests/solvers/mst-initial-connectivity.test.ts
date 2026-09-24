import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("MST skips witnessed initial connections while preserving net and terminal metadata", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 21, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "net1",
        nominalTraceWidth: 0.3,
        __rootConnectionNames: ["root1", "root2"],
        __netConnectionName: "supply",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a" },
          { x: 10, y: 0, layer: "top", pointId: "b" },
          { x: 11, y: 0, layer: "top", pointId: "c" },
          { x: 20, y: 0, layer: "top", pointId: "d" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "existing-trace",
        connection_name: "net1",
        connectsTo: ["a", "d"],
        route: [],
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
  const reached = new Set(["a", "d"])
  let weight = 0
  for (const connection of solver.newConnections) {
    const [a, b] = connection.pointsToConnect
    weight += Math.hypot(a.x - b.x, a.y - b.y)
    expect(connection.nominalTraceWidth).toBe(0.3)
    expect(connection.__rootConnectionNames).toEqual(["root1", "root2"])
    expect(connection.__netConnectionName).toBe("supply")
    for (const point of connection.pointsToConnect) {
      expect(before.connections[0].pointsToConnect).toContainEqual(point)
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const {
      pointsToConnect: [a, b],
    } of solver.newConnections) {
      if (reached.has(a.pointId!)) reached.add(b.pointId!)
      if (reached.has(b.pointId!)) reached.add(a.pointId!)
    }
  }
  expect(reached.size).toBe(4)
  expect(weight).toBe(10)
  expect(srj).toEqual(before)
})

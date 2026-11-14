import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

/** Distinct PCB terminals must not become preconnected merely because their XY match. */
test("MST does not lose a stacked top/bottom terminal at identical XY", () => {
  const srj: SimpleRouteJson = {
    layerCount: 6,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 4, maxY: 4 },
    obstacles: [],
    connections: [
      {
        name: "stacked-net",
        pointsToConnect: [
          { pointId: "top-port", x: 0, y: 0, layer: "top" },
          { pointId: "bottom-port", x: 0, y: 0, layer: "bottom" },
          { pointId: "remote-port", x: 2, y: 0, layer: "top" },
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
  expect(solver.failed).toBe(false)
  expect(solver.newConnections).toHaveLength(2)
  const ids = new Set(
    solver.newConnections.flatMap((c) =>
      c.pointsToConnect.map((p) => p.pointId),
    ),
  )
  expect(ids).toEqual(new Set(["top-port", "bottom-port", "remote-port"]))
})

test("MST preserves every distinct point object even for coincident coordinates", () => {
  const points = [
    { x: 0, y: 0, pointId: "top", layer: "top" },
    { x: 0, y: 0, pointId: "bottom", layer: "bottom" },
    { x: 2, y: 0, pointId: "remote", layer: "top" },
  ]
  const edges = buildMinimumSpanningTree(points, {
    getPointKey: (point) => `${point.x},${point.y},${point.layer}`,
  })
  expect(edges).toHaveLength(points.length - 1)
  const covered = new Set(edges.flatMap((e) => [e.from.pointId, e.to.pointId]))
  expect(covered).toEqual(new Set(["top", "bottom", "remote"]))
})

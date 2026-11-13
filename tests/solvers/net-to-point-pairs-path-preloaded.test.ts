import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("point-pair solvers preserve a declared path through a merged net with preloaded copper", () => {
  const a = { x: 0, y: 0, layer: "top", pointId: "A" }
  const b = { x: 4, y: 4, layer: "top", pointId: "B" }
  const c = { x: 2, y: 0, layer: "top", pointId: "C" }
  const tap = { x: 5, y: 5, layer: "top", pointId: "TP" }
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 6, minY: -1, maxY: 6 },
    obstacles: [],
    connections: [
      { name: "signal", path: ["A", "B", "C"], pointsToConnect: [c, a, b] },
      { name: "tap", pointsToConnect: [b, tap] },
      { name: "overlap", path: ["C", "B"], pointsToConnect: [b, c] },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "existing",
        connection_name: "signal",
        connectsTo: ["A", "B"],
        route: [a, b].map(({ x, y }) => ({
          route_type: "wire",
          x,
          y,
          width: 0.15,
          layer: "top",
        })),
      },
    ],
  }
  const original = structuredClone(input)
  for (const Solver of [
    NetToPointPairsSolver,
    NetToPointPairsSolver2_OffBoardConnection,
  ]) {
    const solver = new Solver(
      input,
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(input),
    )
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(
      solver.newConnections.map(({ pointsToConnect }) =>
        pointsToConnect.map((point) => point.pointId),
      ),
    ).toEqual([
      ["B", "C"],
      ["B", "TP"],
    ])
    expect(solver.getNewSimpleRouteJson().connections).toEqual(
      solver.newConnections,
    )
    expect(input).toEqual(original)
  }
})

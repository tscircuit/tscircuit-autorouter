import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"

const baseSrj = {
  bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 },
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [],
  connections: [
    {
      name: "reroute_a",
      rootConnectionName: "source_net_1",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "reroute_b",
      rootConnectionName: "source_net_1",
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  ],
} satisfies SimpleRouteJson

test("NetToPointPairsSolver preserves existing reroute root connection names", () => {
  const solver = new NetToPointPairsSolver(structuredClone(baseSrj))
  solver.solve()

  expect(
    solver.getNewSimpleRouteJson().connections.map((conn) => ({
      name: conn.name,
      rootConnectionName: conn.rootConnectionName,
    })),
  ).toEqual([
    {
      name: "reroute_a__reroute_b_mst0",
      rootConnectionName: "source_net_1",
    },
    {
      name: "reroute_a__reroute_b_mst1",
      rootConnectionName: "source_net_1",
    },
  ])
})

test("NetToPointPairsSolver2_OffBoardConnection preserves existing reroute root connection names", () => {
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    structuredClone(baseSrj),
  )
  solver.solve()

  expect(
    solver.getNewSimpleRouteJson().connections.map((conn) => ({
      name: conn.name,
      rootConnectionName: conn.rootConnectionName,
    })),
  ).toEqual([
    {
      name: "reroute_a__reroute_b_mst0",
      rootConnectionName: "source_net_1",
    },
    {
      name: "reroute_a__reroute_b_mst1",
      rootConnectionName: "source_net_1",
    },
  ])
})

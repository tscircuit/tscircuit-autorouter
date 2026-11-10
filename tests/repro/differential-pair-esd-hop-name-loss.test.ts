import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("shared ESD pad preserves exact owned hops and routes the ordinary tap", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro()
  expect(srj.connections.map((connection) => connection.name)).toEqual([
    "P:0",
    "P:1",
    "N:0",
    "N:1",
    "tap",
  ])

  for (const Solver of [
    NetToPointPairsSolver,
    NetToPointPairsSolver2_OffBoardConnection,
  ]) {
    const solver = new Solver(
      srj,
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(srj),
    )
    solver.solve()
    expect(
      solver.newConnections.toSorted((a, b) => a.name.localeCompare(b.name)),
    ).toEqual(
      srj.connections
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((connection) =>
          connection.name === "tap"
            ? { ...connection, __rootConnectionNames: ["tap"] }
            : connection,
        ),
    )
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
  }
})

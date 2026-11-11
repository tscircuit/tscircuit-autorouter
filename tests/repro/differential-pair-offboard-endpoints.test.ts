import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("off-board equivalence cannot substitute an owned hop endpoint", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  srj.connections.push({
    name: "offboard",
    isOffBoard: true,
    pointsToConnect: [
      srj.connections[0]!.pointsToConnect[0]!,
      srj.connections[1]!.pointsToConnect[1]!,
    ],
  })
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    srj,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  for (const hop of srj.connections.filter((connection): boolean =>
    connection.name.includes(":"),
  )) {
    expect(solver.newConnections).toContainEqual(hop)
  }
})

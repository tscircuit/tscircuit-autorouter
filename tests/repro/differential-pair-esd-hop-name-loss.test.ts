import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("BUG: shared ESD pad merges pair hops and tap, then MST bypasses ESD and loses hop names", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro()
  expect(srj.connections.map((connection) => connection.name)).toEqual(["P:0", "P:1", "N:0", "N:1", "tap"])
  expect(mergeConnections(srj.connections).map((connection) => connection.name)).toEqual(["P:0__P:1__tap", "N:0__N:1"])

  for (const Solver of [NetToPointPairsSolver, NetToPointPairsSolver2_OffBoardConnection]) {
    const solver = new Solver(srj, {}, getInitiallyConnectedMapFromSimpleRouteJson(srj))
    solver.solve()
    const endpoints = solver.newConnections.map((connection) => connection.pointsToConnect.map((point) => point.port_selector).sort())
    // Current bug, not the desired contract: flip to the original five named
    // endpoint pairs when owned-hop handling lands. ESD must be a through pad.
    expect(endpoints).toContainEqual(["J1.DP", "MCU.DP"])
    expect(endpoints).toContainEqual(["ESD.DP", "MCU.DP"])
    expect(endpoints).toContainEqual(["ESD.DP", "TP.DP"])
    expect(endpoints).toContainEqual(["J1.DM", "MCU.DM"])
    expect(endpoints).not.toContainEqual(["ESD.DP", "J1.DP"])
    expect(solver.newConnections.every((connection) => connection.name.includes("_mst"))).toBe(true)
    expect(solver.newConnections.some((connection) => srj.connections.some((original) => original.name === connection.name))).toBe(false)
  }
})

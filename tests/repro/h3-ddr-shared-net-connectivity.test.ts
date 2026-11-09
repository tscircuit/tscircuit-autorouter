import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import input from "../../fixtures/bug-reports/h3-ddr-shared-net-connectivity/input.srj.json" with {
  type: "json",
}

// Reproduction only: remove .skip to expose the missing routes on main.
// Shared source_trace IDs in connectsTo join separate escape endpoints in the
// initial physical-connectivity map, so point pairing drops both required routes.
test.skip("H3 DDR strobe gaps remain in the point-pair routing work list", () => {
  const srj: SimpleRouteJson = structuredClone(input)
  const initiallyConnectedMap = getInitiallyConnectedMapFromSimpleRouteJson(srj)
  const solver = new NetToPointPairsSolver(srj, {}, initiallyConnectedMap)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.newConnections).toHaveLength(2)
  for (const connection of srj.connections) {
    const [start, end] = connection.pointsToConnect
    expect(
      initiallyConnectedMap.areIdsConnected(start.pointId!, end.pointId!),
    ).toBe(false)
  }
})

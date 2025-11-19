import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import bothPointsEquivalentSrjData from "./srj/both-points-equivalent.srj.json"

/**
 * Tests a scenario where both points of an on-board connection have their own,
 * separate off-board equivalents.
 *
 * Test Setup:
 * - On-board requirement: A -> B
 * - Off-board connections: A -> A', and B -> B'
 *
 * The solver must consider all four possible connection pairs:
 * (A, B), (A, B'), (A', B), and (A', B').
 *
 * Expected Outcome:
 * The solver should identify that the path between A'(1,1) and B'(19,1)
 * is the globally shortest route and create a trace between them.
 */
test("both points equivalent", () => {
  const srj: SimpleRouteJson = bothPointsEquivalentSrjData as any
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  const newConnections = solver.srjWithPointPairs!.connections
  expect(newConnections).toHaveLength(1)
  const pointIds = newConnections[0].pointsToConnect
    .map((p) => p.pointId)
    .sort()
  expect(pointIds).toEqual(["A_prime", "B_prime"])

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

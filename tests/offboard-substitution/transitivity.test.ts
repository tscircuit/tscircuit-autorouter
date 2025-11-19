import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import transitivitySrjData from "./srj/transitivity.srj.json"

/**
 * Tests the solver's ability to handle a transitive chain of off-board
 * connections.
 *
 * Test Setup:
 * - On-board requirement: X -> A
 * - Off-board connections: A -> B, and B -> C
 *
 * This creates a single equivalence group of (A, B, C). The solver must
 * evaluate the path from X to every point in this group.
 *
 * Expected Outcome:
 * The solver should identify that the path from X(0,0) to C(1,1) is the
 * shortest possible route and create a trace between them, ignoring the
 * original A(10,10) and B(20,20) targets.
 */
test("connection.isOffBoard transitivity", () => {
  const srj: SimpleRouteJson = transitivitySrjData as any
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  const newConnections = solver.srjWithPointPairs!.connections
  expect(newConnections).toHaveLength(1)
  const pointIds = newConnections[0].pointsToConnect
    .map((p) => p.pointId)
    .sort()
  expect(pointIds).toEqual(["C", "X"])

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

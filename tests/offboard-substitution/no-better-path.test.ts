import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import noBetterPathSrjData from "./srj/no-better-path.srj.json"

/**
 * Tests a scenario where an off-board substitution is possible but not
 * optimal, ensuring the solver does not make a suboptimal choice.
 *
 * Test Setup:
 * - On-board requirement: X -> A
 * - Off-board connection: A -> B
 *
 * The physical distance from X(0,0) to A(5,5) is significantly shorter
 * than the distance from X(0,0) to B(20,20).
 *
 * Expected Outcome:
 * The solver should evaluate both paths (X->A and X->B) and correctly
 * determine that the original X->A path is the most efficient. The final
 * trace should connect X and A, without substitution.
 */
test("no better path", () => {
  const srj: SimpleRouteJson = noBetterPathSrjData as any
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  const newConnections = solver.srjWithPointPairs!.connections
  expect(newConnections).toHaveLength(1)
  const pointIds = newConnections[0].pointsToConnect
    .map((p) => p.pointId)
    .sort()
  expect(pointIds).toEqual(["A", "X"])

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

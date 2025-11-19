import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import simpleRouteJson from "../../examples/features/off-board-connections/offboardconnects01.srj.json"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = simpleRouteJson as SimpleRouteJson

/**
 * Tests the basic functionality of the `isOffBoard` substitution.
 *
 * Test Setup:
 * - On-board requirement: pointA -> pointB
 * - Off-board connection: pointC -> pointB
 * - pointA(-7, 2), pointB(10, -5), pointC(-7, -5)
 *
 * The physical distance from pointA to pointC (~7 units) is significantly
 * shorter than the distance from pointA to pointB (~18.4 units).
 *
 * Expected Outcome:
 * The solver should evaluate both paths and correctly identify that routing
 * from pointA to pointC is the most efficient, due to pointC being equivalent
 * to pointB. The final trace should connect pointA and pointC.
 */
test("basic connection.isOffBoard support", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

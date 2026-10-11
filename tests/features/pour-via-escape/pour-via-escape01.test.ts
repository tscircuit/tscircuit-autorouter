import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph as AutoroutingPipelineSolver } from "lib"
import bugReport from "../../../fixtures/features/pour-via-escape/pour-via-escape01.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { expectEscapeViasToClearPads } from "../../fixtures/expectEscapeViasToClearPads"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("pour-via-escape01.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expectEscapeViasToClearPads(solver.escapeViaLocationSolver)
})

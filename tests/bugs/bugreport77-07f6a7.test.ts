import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport77-07f6a7/bugreport77-07f6a7.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport77-07f6a7.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  if (solver.failed) {
    throw new Error(`bugreport77 routing failed: ${String(solver.error)}`)
  }
  expect(solver.solved).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

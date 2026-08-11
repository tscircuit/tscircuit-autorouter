import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport89-f8bab9/bugreport89-f8bab9.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport89-f8bab9.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../examples/bug-reports/bugreport27-dd3734/bugreport27-dd3734.json" assert {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport27-dd3734.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

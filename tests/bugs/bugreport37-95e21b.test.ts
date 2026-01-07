import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport37-95e21b/bugreport37-95e21b.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test.skip("bugreport37-95e21b.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

import { test, expect } from "bun:test"
import { AutoroutingPipeline4 } from "lib/autorouter-pipelines/AutoroutingPipeline4/AutoroutingPipeline4"
import bugReport from "../../fixtures/bug-reports/bugreport04-aa1d41/bugreport04-aa1d41.json"
import { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport04-aa1d41.json-autoroutingpipeline-04", () => {
  const solver = new AutoroutingPipeline4(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

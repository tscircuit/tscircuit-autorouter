import { test, expect } from "bun:test"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import bugReport from "../../fixtures/bug-reports/bugreport04-aa1d41/bugreport04-aa1d41.json"
import { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport04-aa1d41.json-autoroutingpipeline-01", () => {
  const solver = new AssignableAutoroutingPipeline1Solver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

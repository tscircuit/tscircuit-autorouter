import { test, expect } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport05-f03221/bugreport05-f03221.json"
import { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/index"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport05-f03221.json-autoroutingpipeline-04", () => {
  const solver = new AutoroutingPipeline1_OriginalUnravel(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 30000)

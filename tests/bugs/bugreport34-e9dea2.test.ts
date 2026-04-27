import { test, expect } from "bun:test"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import bugReport from "../../fixtures/bug-reports/bugreport34-e9dea2/bugreport34-e9dea2.json"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport34-e9dea2.json-AutoroutingPipeline1_OriginalUnravel", () => {
  const solver = new AutoroutingPipeline1_OriginalUnravel(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
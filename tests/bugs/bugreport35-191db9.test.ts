import { test, expect } from "bun:test"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import bugReport from "../../fixtures/bug-reports/bugreport35-191db9/bugreport35-191db9.json"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport35-191db9.json-AutoroutingPipeline1_OriginalUnravel", () => {
  const solver = new AutoroutingPipeline1_OriginalUnravel(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
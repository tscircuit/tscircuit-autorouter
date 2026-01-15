import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport03-fe4a17/bugreport03-fe4a17.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport03-fe4a17.json-AutoroutingPipeline1_OriginalUnravel", () => {
  const solver = new AutoroutingPipeline1_OriginalUnravel(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport03-fe4a17/bugreport03-fe4a17.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AutoroutingPipeline4 } from "lib/autorouter-pipelines/AutoroutingPipeline4/AutoroutingPipeline4"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport03-fe4a17.json-autoroutingpipeline-04", () => {
  const solver = new AutoroutingPipeline4(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

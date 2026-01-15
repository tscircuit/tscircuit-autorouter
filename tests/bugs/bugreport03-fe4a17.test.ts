import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport03-fe4a17/bugreport03-fe4a17.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport03-fe4a17.json-autoroutingpipeline-01", () => {
  const solver = new AssignableAutoroutingPipeline1Solver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

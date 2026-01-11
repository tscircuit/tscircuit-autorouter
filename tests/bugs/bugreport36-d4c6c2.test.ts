import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport36-d4c6c2/bugreport36-d4c6c2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport36-d4c6c2",
  () => {
    const solver = new AssignableAutoroutingPipeline3(srj)

    solver.solve()
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 180_000 },
)

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver8 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport60-fe53a2/bugreport60-fe53a2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport60-fe53a2.json uses the preplaced via in pipeline8", () => {
  const solver = new AutoroutingPipelineSolver8(srj)
  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 30_000)

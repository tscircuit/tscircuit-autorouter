import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport64-be7d8f/bugreport64-be7d8f.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport64-be7d8f.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

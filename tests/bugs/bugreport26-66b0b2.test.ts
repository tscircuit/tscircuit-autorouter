import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline1Solver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport26-66b0b2/bugreport26-66b0b2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport26-66b0b2.json", () => {
  const solver = new AssignableAutoroutingPipeline1Solver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../../fixtures/features/pour-via-escape/pour-via-escape01.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("pour-via-escape01.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

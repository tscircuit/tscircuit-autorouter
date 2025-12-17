import { expect, test } from "bun:test"
import {
  AutoroutingPipeline1_OriginalUnravel,
  AutoroutingPipelineSolver,
} from "lib"
import bugReport from "../../examples/bug-reports/bugreport25-4b1d55/bugreport25-4b1d55.json" assert {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport25-4b1d55.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

test("bugreport25-4b1d55.json (legacy pipeline)", () => {
  const solver = new AutoroutingPipeline1_OriginalUnravel(srj)
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.highDensityRouteSolver?.failedSolvers.length).toBe(0)
})

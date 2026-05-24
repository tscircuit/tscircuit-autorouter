import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver,
  AutoroutingPipelineSolver7_MultiGraph,
} from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport63-274be2/bugreport63-274be2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport63-274be2.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

test("bugreport63-274be2.json solves with pipeline7 QFP thermal-pad topology", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj)

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})

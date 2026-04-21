import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport49-8536f4/bugreport49-8536f4.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport49-8536f4.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(solver.solved).toBe(true)
  const svg = getLastStepSvg(solver.visualize())
  const tolerance = svg.length * 0.5 // about 50% tolerance
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    {
      // actual pixel number that can be diffrent
      tolerance,
    },
  )
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport80-75ab58/bugreport80-75ab58.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport80-75ab58.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  expect(() => solver.solve()).toThrow(
    'PostProcessingSolver: HD route "source_trace_69" must have exactly one via for each layer transition',
  )
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

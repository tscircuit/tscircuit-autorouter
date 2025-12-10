import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "examples/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4-4-layer.srj.json" assert {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport as SimpleRouteJson

// Regression: obstacle-clipping solver previously got stuck when safe intervals became empty
// for segments adjacent to small rectangular obstacles around the endpoints.

test("LGA15x4-4-layer", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

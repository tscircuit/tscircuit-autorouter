import { expect, test } from "bun:test"
import bugReport from "fixtures/bug-reports/missing-port-points-001/missing-port-points-001.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AutoroutingPipelineSolver } from "lib/index"

const srj = bugReport as SimpleRouteJson

test("missing-port-points-001", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

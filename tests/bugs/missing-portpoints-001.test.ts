import { expect, test } from "bun:test"
import bugReport from "fixtures/bug-reports/missing-port-points-001/missing-port-points-001.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/index"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

const srj = bugReport as SimpleRouteJson

test("missing-port-points-001", () => {
  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(srj)
  solver.solve()
  expect(solver.solved).toBe(false)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

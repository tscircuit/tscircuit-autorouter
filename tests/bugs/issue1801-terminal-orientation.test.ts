import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/issue1801-terminal-orientation/issue1801-terminal-orientation.srj.json"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("issue 1801 routes the placement without a terminal orientation error", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    srj as SimpleRouteJson,
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

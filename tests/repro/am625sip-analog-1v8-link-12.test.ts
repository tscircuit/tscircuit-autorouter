import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import realBoardPhase from "../../fixtures/repro/am625sip-analog-1v8-link-12.srj.json"

test("routes the faithful AM625SIP analog 1.8 V link 12 phase", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(realBoardPhase) as SimpleRouteJson,
    { cacheProvider: null },
  )

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.highDensityNodePortPoints).toHaveLength(4)
  expect(solver.highDensityRouteSolver?.nodePfById.size).toBe(
    solver.highDensityNodePortPoints?.length,
  )
})

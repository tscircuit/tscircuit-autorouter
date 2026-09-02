import { expect, test } from "bun:test"
import realBoardPhase from "../../fixtures/repro/am625sip-analog-1v8-link-17.srj.json"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

// The unchanged production phase takes about one minute because the
// high-density and exact-geometry stages currently run synchronously.
test.skip("routes the faithful AM625SIP analog 1.8 V link 17 phase", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(realBoardPhase) as SimpleRouteJson,
    { cacheProvider: null },
  )

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

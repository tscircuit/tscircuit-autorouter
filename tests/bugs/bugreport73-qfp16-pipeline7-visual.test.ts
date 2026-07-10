import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport73-qfp16/bugreport73-qfp16.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const bugreport73Qfp16Srj = srj as SimpleRouteJson

test("bugreport73 qfp16 pipeline7 visual snapshot", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(bugreport73Qfp16Srj),
    {
      cacheProvider: null,
    },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

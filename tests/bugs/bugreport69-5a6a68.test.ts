import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import phaseInputs from "../../fixtures/bug-reports/bugreport69-5a6a68/bugreport69-5a6a68.phase-inputs.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const [srj] = phaseInputs as SimpleRouteJson[]

test("bugreport69-5a6a68 fails pipeline7 static reachability precheck", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj)
  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import solverInput from "../../fixtures/bug-reports/bugreport89-issue2065/bugreport89-issue2065-min-vias.solver-input.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("bugreport89 issue 2065 0.3 mm hole and 0.45 mm pad vias", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(solverInput.input) as SimpleRouteJson,
    solverInput.options,
  )

  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

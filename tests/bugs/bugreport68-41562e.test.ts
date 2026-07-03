import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import bugReport from "../../fixtures/bug-reports/bugreport68-41562e/bugreport68-41562e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport68-41562e.json", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj)
  solver.solve()
  const targetRoute = solver.traceSimplificationSolver?.simplifiedHdRoutes.find(
    (route) => route.connectionName === "source_trace_47__source_net_1_mst12",
  )
  expect(targetRoute?.route.at(-1)).toMatchObject({
    x: -17.500129,
    y: 34.424936,
    z: 0,
  })
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport82-0e99ec/bugreport82-0e99ec.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport82-0e99ec.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  const output = solver.getOutputSimpleRouteJson()
  const postProcessingOutput =
    solver.lengthMatchingPostProcessingSolver!.getOutput()
  const returnedNonIdealRoute = postProcessingOutput.hdRoutes.find(
    (route) => route.connectionName === "source_net_8_mst3",
  )
  const prePostProcessingRoute =
    solver.exactGeometryDrcForceImproveSolver!.getOutput().find(
      (route) => route.connectionName === "source_net_8_mst3",
    )

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(returnedNonIdealRoute).toEqual(prePostProcessingRoute)
  expect(output.nonIdealRouteIssues).toEqual([
    {
      type: "post_processing_error",
      stage: "coupled-rerouting",
      postProcessingStage: "validation",
      message:
        'PostProcessingSolver: HD route "source_net_8_mst3" must have exactly one via for each layer transition',
      connectionName: "source_net_8_mst3",
      returnedRouteSource: "post-processing-input",
    },
  ])
})

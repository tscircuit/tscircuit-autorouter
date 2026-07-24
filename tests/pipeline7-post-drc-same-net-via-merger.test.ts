import { expect, test } from "bun:test"
import input from "../fixtures/legacy/assets/e2e3.json"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline 7 has one post-DRC optimization stage", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    input as SimpleRouteJson,
  )
  const postDrcStageNames = solver.pipelineDef
    .map((pipelineStep) => pipelineStep.solverName)
    .filter((solverName) => solverName.startsWith("postDrc"))

  expect(postDrcStageNames).toEqual(["postDrcSameNetViaMergerSolver"])
})

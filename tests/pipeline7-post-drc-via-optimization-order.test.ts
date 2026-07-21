import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 runs via optimization after exact DRC repair", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any)
  const stageNames = solver.pipelineDef.map((stage) => stage.solverName)
  const exactDrcStageIndex = stageNames.indexOf(
    "exactGeometryDrcForceImproveSolver",
  )

  expect(stageNames.slice(exactDrcStageIndex)).toEqual([
    "exactGeometryDrcForceImproveSolver",
    "postDrcUselessViaRemovalSolver",
    "postDrcSameNetViaMergerSolver",
  ])
})

import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

export const getComponentTopologySvg = (srj: SimpleRouteJson) => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  const componentTopologyStepIndex = solver.pipelineDef.findIndex(
    (step) => step.solverName === "componentTopologyGeneratorSolver",
  )

  while (
    !solver.solved &&
    !solver.failed &&
    solver.currentPipelineStepIndex <= componentTopologyStepIndex
  ) {
    solver.step()
  }

  return getSvgFromGraphicsObject(
    solver.componentTopologyGeneratorSolver!.visualize(),
    { backgroundColor: "white" },
  )
}

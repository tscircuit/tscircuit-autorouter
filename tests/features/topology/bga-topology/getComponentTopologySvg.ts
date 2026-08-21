import { getSvgFromGraphicsObject } from "graphics-debug";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import type { SimpleRouteJson } from "lib/types";

export const getComponentTopologySvg = (srj: SimpleRouteJson) => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    { cacheProvider: null },
  );
  const topologyPlanningStepIndex = solver.pipelineDef.findIndex(
    (step) => step.solverName === "topologyPlanningSolver",
  );

  while (
    !solver.solved &&
    !solver.failed &&
    solver.currentPipelineStepIndex <= topologyPlanningStepIndex
  ) {
    solver.step();
  }

  return getSvgFromGraphicsObject(
    solver.componentTopologyGeneratorSolver!.visualize(),
    { backgroundColor: "white" },
  );
};

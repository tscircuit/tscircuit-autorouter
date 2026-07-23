import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import {
  AutoroutingPipelineSolver7_MultiGraph,
  type AutoroutingPipelineSolverOptions,
} from "../AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { PreloadedTraceGraphSolver } from "./preloaded-trace-graph-solver"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "./preprocess-simple-route-json-without-trace-obstacles-solver"

type PipelineStep = {
  solverName: string
  solverClass: new (...args: any[]) => BaseSolver
  getConstructorParams: (
    instance: AutoroutingPipelineSolver7_MultiGraph,
  ) => any[]
  onSolved?: (instance: AutoroutingPipelineSolver7_MultiGraph) => void
}

export class AutoroutingPipelineSolver9_PreloadedTraceGraph extends AutoroutingPipelineSolver7_MultiGraph {
  preloadedTraceGraphSolver?: PreloadedTraceGraphSolver

  constructor(
    srj: SimpleRouteJson,
    opts: AutoroutingPipelineSolverOptions = {},
  ) {
    super(srj, opts)
    const pipelineDef = this.pipelineDef as PipelineStep[]
    const preprocessStep = pipelineDef.find(
      (step) => step.solverName === "preprocessSimpleRouteJsonSolver",
    )
    if (!preprocessStep) {
      throw new Error("Pipeline9 could not find the preprocessing stage")
    }
    preprocessStep.solverClass =
      PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver

    const subdivisionStageIndex = pipelineDef.findIndex(
      (step) => step.solverName === "nodeDimensionSubdivisionSolver",
    )
    if (subdivisionStageIndex === -1) {
      throw new Error("Pipeline9 could not find the node subdivision stage")
    }
    pipelineDef.splice(subdivisionStageIndex + 1, 0, {
      solverName: "preloadedTraceGraphSolver",
      solverClass: PreloadedTraceGraphSolver,
      getConstructorParams: (pipeline) => [
        pipeline.capacityNodes!,
        pipeline.originalSrj,
      ],
      onSolved: (pipeline) => {
        const pipeline9 =
          pipeline as AutoroutingPipelineSolver9_PreloadedTraceGraph
        pipeline9.capacityNodes = pipeline9.preloadedTraceGraphSolver!.getOutput()
      },
    })
  }

  override getSolverName(): string {
    return "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  }
}

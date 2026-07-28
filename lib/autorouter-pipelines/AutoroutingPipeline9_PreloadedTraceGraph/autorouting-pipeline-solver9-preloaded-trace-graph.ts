import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import {
  AutoroutingPipelineSolver7_MultiGraph,
  type AutoroutingPipelineSolverOptions,
} from "../AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { convertPreloadedTraceToHdRoutes } from "./convert-preloaded-traces-to-hd-routes"
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

/**
 * Pipeline7 with pre-routed traces loaded as hypergraph assignments.
 *
 * All routing, stitching, simplification, and DRC stages otherwise remain
 * Pipeline7 defaults.
 */
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

    const crampedPortStageIndex = pipelineDef.findIndex(
      (step) => step.solverName === "necessaryCrampedPortPointSolver",
    )
    if (crampedPortStageIndex === -1) {
      throw new Error("Pipeline9 could not find the cramped-port stage")
    }
    pipelineDef.splice(crampedPortStageIndex + 1, 0, {
      solverName: "preloadedTraceGraphSolver",
      solverClass: PreloadedTraceGraphSolver,
      getConstructorParams: (pipeline) => [
        pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints ??
          pipeline.necessaryCrampedPortPointSolver!.getOutput(),
        pipeline.srjWithPointPairs!,
      ],
    })

    const traceSimplificationStep = pipelineDef.find(
      (step) => step.solverName === "traceSimplificationSolver",
    )
    if (!traceSimplificationStep) {
      throw new Error("Pipeline9 could not find the trace simplification stage")
    }
    const getBaseTraceSimplificationParams =
      traceSimplificationStep.getConstructorParams
    traceSimplificationStep.getConstructorParams = (pipeline) => {
      const [params, ...remainingParams] =
        getBaseTraceSimplificationParams(pipeline)
      const preloadedHdRoutes = (pipeline.originalSrj.traces ?? []).flatMap(
        (trace, traceIndex) =>
          convertPreloadedTraceToHdRoutes(
            trace,
            traceIndex,
            pipeline.originalSrj.layerCount,
            pipeline.viaDiameter,
            pipeline.connMap,
          ),
      )
      return [
        {
          ...params,
          otherHdRoutes: preloadedHdRoutes,
        },
        ...remainingParams,
      ]
    }
  }

  override getSolverName(): string {
    return "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  }
}

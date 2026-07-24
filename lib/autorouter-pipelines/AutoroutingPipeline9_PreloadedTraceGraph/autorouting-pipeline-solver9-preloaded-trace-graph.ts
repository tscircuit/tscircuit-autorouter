import type { DrcEvaluator } from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import {
  AutoroutingPipelineSolver7_MultiGraph,
  type AutoroutingPipelineSolverOptions,
} from "../AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { PreloadedTraceGraphSolver } from "./preloaded-trace-graph-solver"
import { Pipeline9ExactDrcRepairSolver } from "./pipeline9-exact-drc-repair-solver"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "./preprocess-simple-route-json-without-trace-obstacles-solver"

type PipelineStep = {
  solverName: string
  solverClass: new (...args: any[]) => BaseSolver
  getConstructorParams: (
    instance: AutoroutingPipelineSolver7_MultiGraph,
  ) => any[]
  onSolved?: (instance: AutoroutingPipelineSolver7_MultiGraph) => void
}

const getAxisAlignedRepairObstacle = (obstacle: Obstacle): Obstacle => {
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  if (Math.abs(radians) < 1e-9) return obstacle

  return {
    ...obstacle,
    width:
      Math.abs(obstacle.width * Math.cos(radians)) +
      Math.abs(obstacle.height * Math.sin(radians)),
    height:
      Math.abs(obstacle.width * Math.sin(radians)) +
      Math.abs(obstacle.height * Math.cos(radians)),
    ccwRotationDegrees: 0,
  }
}

const createPadCenteredDrcEvaluator = (
  evaluator: DrcEvaluator | undefined,
  originalObstacles: Obstacle[],
): DrcEvaluator | undefined => {
  if (!evaluator) return undefined

  const physicalObstacleById = new Map<string, Obstacle>()
  for (const obstacle of originalObstacles) {
    const physicalIds = [
      obstacle.connectedTo.find((id) => id.startsWith("pcb_smtpad_")),
      obstacle.connectedTo.find((id) => id.startsWith("pcb_plated_hole_")),
    ]
    for (const physicalId of physicalIds) {
      if (physicalId && !physicalObstacleById.has(physicalId)) {
        physicalObstacleById.set(physicalId, obstacle)
      }
    }
  }
  const addAccuratePadCenters = (
    errors: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> =>
    errors.map((error) => {
      const errorType =
        typeof error.error_type === "string"
          ? error.error_type
          : typeof error.type === "string"
            ? error.type
            : undefined
      if (
        errorType !== "pcb_pad_trace_clearance_error" ||
        typeof error.pcb_pad_id !== "string"
      ) {
        return error
      }
      const obstacle = physicalObstacleById.get(error.pcb_pad_id)
      return obstacle ? { ...error, center: obstacle.center } : error
    })

  return (input) => {
    const result = evaluator(input)
    if (Array.isArray(result)) {
      return addAccuratePadCenters(result)
    }
    return {
      ...result,
      errors: addAccuratePadCenters(result.errors),
      errorsWithCenters: addAccuratePadCenters(
        result.errorsWithCenters ?? result.errors,
      ),
    }
  }
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
        pipeline9.capacityNodes =
          pipeline9.preloadedTraceGraphSolver!.getOutput()
      },
    })

    const exactDrcStep = pipelineDef.find(
      (step) => step.solverName === "exactGeometryDrcForceImproveSolver",
    )
    if (!exactDrcStep) {
      throw new Error("Pipeline9 could not find the exact DRC repair stage")
    }
    exactDrcStep.solverClass = Pipeline9ExactDrcRepairSolver
    const getBaseExactDrcParams = exactDrcStep.getConstructorParams
    exactDrcStep.getConstructorParams = (pipeline) => {
      const [params] = getBaseExactDrcParams(pipeline)
      const originalObstacles = pipeline.originalSrj.obstacles
      const drcEvaluator = createPadCenteredDrcEvaluator(
        params.drcEvaluator,
        originalObstacles,
      )
      const viaInPadDrcEvaluator = createPadCenteredDrcEvaluator(
        params.viaInPadDrcEvaluator,
        originalObstacles,
      )
      return [
        {
          ...params,
          drcEvaluator,
          viaInPadDrcEvaluator,
          originalObstacles,
          srj: {
            ...params.srj,
            obstacles: originalObstacles.map(getAxisAlignedRepairObstacle),
          },
        },
      ]
    }
  }

  override getSolverName(): string {
    return "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  }
}

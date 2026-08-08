import type { SimpleRouteJson } from "lib/types"
import {
  type AutoroutingPipelineSolverOptions as Pipeline7Options,
  AutoroutingPipelineSolver7_MultiGraph,
} from "../AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { ApproximateLayerTransitionSolver } from "./ApproximateLayerTransitionSolver"
import { ApproximateMultiGraphTopologyPlannerSolver } from "./ApproximateMultiGraphTopologyPlannerSolver"

export interface AutoroutingPipelineSolver10Options extends Pipeline7Options {
  approximateCellSize?: number
  approximateMaxPortsPerLayerPerEdge?: number
  approximateObstacleSamplingMargin?: number
}

export class AutoroutingPipelineSolver10_ApproximateHypergraph extends AutoroutingPipelineSolver7_MultiGraph {
  approximateLayerTransitionSolver?: ApproximateLayerTransitionSolver
  readonly pipeline10Opts: AutoroutingPipelineSolver10Options

  constructor(
    srj: SimpleRouteJson,
    opts: AutoroutingPipelineSolver10Options = {},
  ) {
    super(srj, opts)
    this.pipeline10Opts = { ...opts }

    const topologyPlanningIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "topologyPlanningSolver",
    )
    if (topologyPlanningIndex < 0) {
      throw new Error("Pipeline10 requires Pipeline7 topologyPlanningSolver")
    }
    const highDensityStitchIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "highDensityStitchSolver",
    )
    if (highDensityStitchIndex < topologyPlanningIndex) {
      throw new Error("Pipeline10 requires Pipeline7 highDensityStitchSolver")
    }

    const approximateTopologyPlanningStep = {
      solverName: "topologyPlanningSolver",
      solverClass: ApproximateMultiGraphTopologyPlannerSolver,
      getConstructorParams: (
        instance: AutoroutingPipelineSolver7_MultiGraph,
      ) => {
        const pipeline10 =
          instance as AutoroutingPipelineSolver10_ApproximateHypergraph
        if (!pipeline10.srjWithPointPairs) {
          throw new Error(
            "Pipeline10 requires point-pair connections before approximate topology planning",
          )
        }
        return [
          {
            inputSrj: pipeline10.srjWithPointPairs,
            componentDetectionOutput:
              pipeline10.componentDetectionSolver!.getOutput(),
            viaDiameter: pipeline10.viaDiameter,
            obstacleMargin:
              pipeline10.srj.defaultObstacleMargin ?? 0.15,
            targetCellSize: pipeline10.pipeline10Opts.approximateCellSize,
            obstacleSamplingMargin:
              pipeline10.pipeline10Opts.approximateObstacleSamplingMargin,
          },
        ] as const
      },
      onSolved: (instance: AutoroutingPipelineSolver7_MultiGraph): void => {
        const pipeline10 =
          instance as AutoroutingPipelineSolver10_ApproximateHypergraph
        const planner =
          pipeline10.topologyPlanningSolver as ApproximateMultiGraphTopologyPlannerSolver
        if (!planner) {
          throw new Error(
            "Pipeline10 approximate topology planner finished without output",
          )
        }
        pipeline10.componentTopologyGeneratorSolver = undefined
        pipeline10.globalTopologyGeneratorSolver = undefined
      },
    } as unknown as (typeof this.pipelineDef)[number]

    const necessaryCrampedIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "necessaryCrampedPortPointSolver",
    )
    if (necessaryCrampedIndex < 0) {
      throw new Error(
        "Pipeline10 requires Pipeline7 necessaryCrampedPortPointSolver",
      )
    }
    const baseNecessaryCrampedStep = this.pipelineDef[necessaryCrampedIndex]!
    const cappedNecessaryCrampedStep = {
      ...baseNecessaryCrampedStep,
      getConstructorParams: (
        instance: AutoroutingPipelineSolver7_MultiGraph,
      ) => {
        const [params] = baseNecessaryCrampedStep.getConstructorParams(instance)
        const pipeline10 =
          instance as AutoroutingPipelineSolver10_ApproximateHypergraph
        return [
          {
            ...params,
            numberOfCrampedPortPointsToKeep:
              pipeline10.pipeline10Opts
                .approximateMaxPortsPerLayerPerEdge ?? 6,
          },
        ]
      },
    } as unknown as (typeof this.pipelineDef)[number]

    const approximateLayerTransitionStep = {
      solverName: "approximateLayerTransitionSolver",
      solverClass: ApproximateLayerTransitionSolver,
      getConstructorParams: (
        instance: AutoroutingPipelineSolver7_MultiGraph,
      ) => {
        if (!instance.highDensityStitchSolver) {
          throw new Error(
            "Pipeline10 requires stitched routes before layer-transition normalization",
          )
        }
        return [
          { hdRoutes: instance.highDensityStitchSolver.mergedHdRoutes },
        ] as const
      },
      onSolved: (instance: AutoroutingPipelineSolver7_MultiGraph): void => {
        const pipeline10 =
          instance as AutoroutingPipelineSolver10_ApproximateHypergraph
        const normalizedRoutes =
          pipeline10.approximateLayerTransitionSolver?.getOutput()
        if (!normalizedRoutes || !instance.highDensityStitchSolver) {
          throw new Error(
            "Pipeline10 layer-transition normalizer finished without output",
          )
        }
        instance.highDensityStitchSolver.mergedHdRoutes = normalizedRoutes
      },
    } as unknown as (typeof this.pipelineDef)[number]

    this.pipelineDef[topologyPlanningIndex] = approximateTopologyPlanningStep
    this.pipelineDef[necessaryCrampedIndex] = cappedNecessaryCrampedStep
    this.pipelineDef.splice(
      highDensityStitchIndex + 1,
      0,
      approximateLayerTransitionStep,
    )
  }

  override getSolverName(): string {
    return "AutoroutingPipelineSolver10_ApproximateHypergraph"
  }

  override getConstructorParams(): readonly [
    SimpleRouteJson,
    AutoroutingPipelineSolver10Options,
  ] {
    return [this.srj, this.pipeline10Opts]
  }
}

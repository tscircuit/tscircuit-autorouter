import type { SimpleRouteJson } from "lib/types"
import {
  type AutoroutingPipelineSolverOptions as Pipeline7Options,
  AutoroutingPipelineSolver7_MultiGraph,
} from "../AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { ApproximateHypergraphTopologySolver } from "./ApproximateHypergraphTopologySolver"
import { ApproximateLayerTransitionSolver } from "./ApproximateLayerTransitionSolver"

export interface AutoroutingPipelineSolver10Options extends Pipeline7Options {
  approximateCellSize?: number
  approximateMaxPortsPerLayerPerEdge?: number
  approximateObstacleSamplingMargin?: number
}

export class AutoroutingPipelineSolver10_ApproximateHypergraph extends AutoroutingPipelineSolver7_MultiGraph {
  approximateHypergraphTopologySolver?: ApproximateHypergraphTopologySolver
  approximateLayerTransitionSolver?: ApproximateLayerTransitionSolver
  readonly pipeline10Opts: AutoroutingPipelineSolver10Options

  constructor(
    srj: SimpleRouteJson,
    opts: AutoroutingPipelineSolver10Options = {},
  ) {
    super(srj, opts)
    this.pipeline10Opts = { ...opts }

    const preprocessStep = this.getPipelineStepOrThrow(
      "preprocessSimpleRouteJsonSolver",
    )
    const escapeStep = this.getPipelineStepOrThrow("escapeViaLocationSolver")
    const pointPairsStep = this.getPipelineStepOrThrow("netToPointPairsSolver")
    const portPathingIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "portPointPathingSolver",
    )
    if (portPathingIndex < 0) {
      throw new Error("Pipeline10 requires Pipeline7 portPointPathingSolver")
    }
    const highDensityStitchIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "highDensityStitchSolver",
    )
    if (highDensityStitchIndex < portPathingIndex) {
      throw new Error("Pipeline10 requires Pipeline7 highDensityStitchSolver")
    }

    const approximateTopologyStep = {
      solverName: "approximateHypergraphTopologySolver",
      solverClass: ApproximateHypergraphTopologySolver,
      getConstructorParams: (
        instance: AutoroutingPipelineSolver7_MultiGraph,
      ) => {
        const pipeline10 =
          instance as AutoroutingPipelineSolver10_ApproximateHypergraph
        if (!pipeline10.srjWithPointPairs) {
          throw new Error(
            "Pipeline10 requires point-pair connections before approximate topology generation",
          )
        }
        return [
          {
            simpleRouteJson: pipeline10.srjWithPointPairs,
            targetCellSize: pipeline10.pipeline10Opts.approximateCellSize,
            maxPortsPerLayerPerEdge:
              pipeline10.pipeline10Opts.approximateMaxPortsPerLayerPerEdge,
            obstacleSamplingMargin:
              pipeline10.pipeline10Opts.approximateObstacleSamplingMargin,
          },
        ] as const
      },
      onSolved: (instance: AutoroutingPipelineSolver7_MultiGraph): void => {
        const pipeline10 =
          instance as AutoroutingPipelineSolver10_ApproximateHypergraph
        const output = pipeline10.approximateHypergraphTopologySolver?.getOutput()
        if (!output) {
          throw new Error(
            "Pipeline10 approximate topology solver finished without output",
          )
        }
        pipeline10.capacityNodes = output.capacityMeshNodes
        pipeline10.capacityEdges = output.capacityMeshEdges
        pipeline10.sharedEdgeSegmentsWithNecessaryCrampedPortPoints =
          output.sharedEdgeSegments
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

    const downstreamSteps = this.pipelineDef.slice(portPathingIndex)
    const relativeStitchIndex = downstreamSteps.findIndex(
      (step) => step.solverName === "highDensityStitchSolver",
    )
    downstreamSteps.splice(
      relativeStitchIndex + 1,
      0,
      approximateLayerTransitionStep,
    )

    this.pipelineDef = [
      preprocessStep,
      escapeStep,
      pointPairsStep,
      approximateTopologyStep,
      ...downstreamSteps,
    ]
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

  private getPipelineStepOrThrow(solverName: string) {
    const pipelineStep = this.pipelineDef.find(
      (step) => step.solverName === solverName,
    )
    if (!pipelineStep) {
      throw new Error(`Pipeline10 requires Pipeline7 stage "${solverName}"`)
    }
    return pipelineStep
  }
}

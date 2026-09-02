import {
  BasePipelineSolver,
  definePipelineStep,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import type { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import {
  ApplyTraceSimplificationSolver,
  type ApplyTraceSimplificationSolverInput,
} from "./ApplyTraceSimplificationSolver"
import {
  PrepareTraceSimplificationSolver,
  type PrepareTraceSimplificationSolverInput,
} from "./PrepareTraceSimplificationSolver"
import {
  TraceSimplificationStageSolver,
  type TraceSimplificationStageSolverInput,
} from "./TraceSimplificationStageSolver"
import {
  ValidateTraceSimplificationSolver,
  type ValidateTraceSimplificationSolverInput,
} from "./ValidateTraceSimplificationSolver"

export interface AutoroutingPipelineSolver11SimplificationOptions {
  /** Number of complete cleanup passes. Defaults to two. */
  iterations?: number
  /** Enables coordinated layer swaps that reduce vias at crossings. */
  enableCrossingViaReduction?: boolean
}

type AutoroutingPipeline11SimplificationInput = {
  inputSrj: SimpleRouteJson
  options: AutoroutingPipelineSolver11SimplificationOptions
}

/**
 * Pipeline 11 only cleans traces already present in the input SRJ. It never
 * routes missing connections. Mixed-width traces remain immutable because the
 * cleanup solvers operate on constant-width high-density routes.
 */
export class AutoroutingPipelineSolver11_Simplification extends BasePipelineSolver<AutoroutingPipeline11SimplificationInput> {
  prepareTraceSimplificationSolver?: PrepareTraceSimplificationSolver
  traceSimplificationStageSolver?: TraceSimplificationStageSolver
  applyTraceSimplificationSolver?: ApplyTraceSimplificationSolver
  validateTraceSimplificationSolver?: ValidateTraceSimplificationSolver

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "prepareTraceSimplificationSolver",
      PrepareTraceSimplificationSolver,
      (pipeline: AutoroutingPipelineSolver11_Simplification) => [
        {
          inputSrj: pipeline.inputProblem.inputSrj,
          options: pipeline.inputProblem.options,
        } satisfies PrepareTraceSimplificationSolverInput,
      ],
    ),
    definePipelineStep(
      "traceSimplificationStageSolver",
      TraceSimplificationStageSolver,
      (pipeline: AutoroutingPipelineSolver11_Simplification) => [
        {
          preparedInput:
            pipeline.prepareTraceSimplificationSolver!.getOutput(),
        } satisfies TraceSimplificationStageSolverInput,
      ],
    ),
    definePipelineStep(
      "applyTraceSimplificationSolver",
      ApplyTraceSimplificationSolver,
      (pipeline: AutoroutingPipelineSolver11_Simplification) => [
        {
          preparedInput:
            pipeline.prepareTraceSimplificationSolver!.getOutput(),
          simplifiedHdRoutes:
            pipeline.traceSimplificationStageSolver!.getOutput(),
        } satisfies ApplyTraceSimplificationSolverInput,
      ],
    ),
    definePipelineStep(
      "validateTraceSimplificationSolver",
      ValidateTraceSimplificationSolver,
      (pipeline: AutoroutingPipelineSolver11_Simplification) => [
        {
          preparedInput:
            pipeline.prepareTraceSimplificationSolver!.getOutput(),
          outputSrj: pipeline.applyTraceSimplificationSolver!.getOutput(),
        } satisfies ValidateTraceSimplificationSolverInput,
      ],
    ),
  ]

  constructor(
    inputSrj: SimpleRouteJson,
    options: AutoroutingPipelineSolver11SimplificationOptions = {},
  ) {
    if (
      options.iterations !== undefined &&
      (!Number.isInteger(options.iterations) || options.iterations < 1)
    ) {
      throw new Error("Simplification iterations must be a positive integer")
    }
    super({ inputSrj, options: { ...options } })
    this.MAX_ITERATIONS = 100e6
  }

  override getSolverName(): string {
    return "AutoroutingPipelineSolver11_Simplification"
  }

  override getConstructorParams(): readonly [
    SimpleRouteJson,
    AutoroutingPipelineSolver11SimplificationOptions,
  ] {
    return [this.inputProblem.inputSrj, this.inputProblem.options] as const
  }

  override getOutput(): SimpleRouteJson {
    if (!this.validateTraceSimplificationSolver?.solved) {
      throw new Error("Pipeline 11 simplification has not solved yet")
    }
    return this.validateTraceSimplificationSolver.getOutput()
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return this.getOutput()
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    return structuredClone(this.getOutput().traces ?? [])
  }

  override initialVisualize(): GraphicsObject {
    return convertSrjToGraphicsObject(this.inputProblem.inputSrj)
  }

  override finalVisualize(): GraphicsObject {
    return convertSrjToGraphicsObject(this.getOutput())
  }
}

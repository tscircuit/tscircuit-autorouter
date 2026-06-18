import { BaseSolver as PipelineBaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/index"
import {
  MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS,
  type DuplicateCongestedPortPrepassInput,
  type DuplicateCongestedPortPrepassOutput,
} from "./types"

export class DuplicateCongestedPortPrepassSolver extends PipelineBaseSolver {
  private duplicateCongestedPortSolver?: DuplicateCongestedPortSolver
  private output: DuplicateCongestedPortPrepassOutput

  constructor(private readonly input: DuplicateCongestedPortPrepassInput) {
    super()
    this.MAX_ITERATIONS = Number.POSITIVE_INFINITY

    const shouldRunDuplicateCongestedPortPrepass =
      input.connectionCount <= MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS

    this.output = {
      graphForTiny: input.serializedGraph,
      duplicateCongestedPortError: shouldRunDuplicateCongestedPortPrepass
        ? undefined
        : `Skipped for ${input.connectionCount} connections`,
      duplicatedPortCount: 0,
    }

    if (!shouldRunDuplicateCongestedPortPrepass) {
      return
    }

    this.duplicateCongestedPortSolver = new DuplicateCongestedPortSolver(
      input.serializedGraph,
      {
        duplicatePortProximity: 0.05,
        routeSolveOptions: {
          ...(Number.isFinite(input.minViaPadDiameter)
            ? { minViaPadDiameter: input.minViaPadDiameter }
            : {}),
          USE_SPARSE_CANDIDATE_STORAGE: true,
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
          GREEDY_FINAL_ROUTE_ITERS: 4,
          MAX_ITERATIONS: Math.ceil(2_000_000 * Math.max(input.effort, 1e-2)),
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
          STATIC_REACHABILITY_PRECHECK: false,
        },
      },
    )
    this.activeSubSolver = this.duplicateCongestedPortSolver
  }

  override _step() {
    if (!this.duplicateCongestedPortSolver) {
      this.progress = 1
      this.solved = true
      return
    }

    this.duplicateCongestedPortSolver.step()
    this.activeSubSolver = this.duplicateCongestedPortSolver
    this.progress = this.duplicateCongestedPortSolver.progress

    if (this.duplicateCongestedPortSolver.failed) {
      this.output = {
        ...this.output,
        graphForTiny: this.input.serializedGraph,
        duplicateCongestedPortError:
          this.duplicateCongestedPortSolver.error ?? "unknown error",
      }
      this.activeSubSolver = null
      this.progress = 1
      this.error = null
      this.failed = false
      this.solved = true
      return
    }

    if (!this.duplicateCongestedPortSolver.solved) {
      return
    }

    const duplicateCongestedPortReport = this.duplicateCongestedPortSolver.report
    const duplicatedPortCount =
      duplicateCongestedPortReport.duplicatedPorts.reduce(
        (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
        0,
      )

    this.output = {
      graphForTiny: this.duplicateCongestedPortSolver.getOutput(),
      duplicateCongestedPortReport,
      duplicateCongestedPortError: this.output.duplicateCongestedPortError,
      duplicatedPortCount,
    }
    this.activeSubSolver = null
    this.progress = 1
    this.solved = true
  }

  override getOutput(): DuplicateCongestedPortPrepassOutput {
    return this.output
  }

  override getConstructorParams() {
    return [this.input] as const
  }

  override visualize(): GraphicsObject {
    return this.duplicateCongestedPortSolver?.visualize() ?? super.visualize()
  }
}

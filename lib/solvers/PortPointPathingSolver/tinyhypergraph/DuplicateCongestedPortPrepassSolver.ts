import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  DuplicateCongestedPortSolver,
  type DuplicateCongestedPortSolverReport,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"

export type DuplicateCongestedPortPrepassSolverInput = {
  serializedHyperGraph: SerializedHyperGraph
  connectionCount: number
  effort: number
  minViaPadDiameter?: number
}

export type DuplicateCongestedPortPrepassSolverOutput = {
  serializedHyperGraph: SerializedHyperGraph
  report?: DuplicateCongestedPortSolverReport
  error?: string
  skipped: boolean
  duplicatedPortCount: number
}

const MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS = 180

export class DuplicateCongestedPortPrepassSolver extends BaseSolver {
  private output?: DuplicateCongestedPortPrepassSolverOutput
  private duplicateSolver?: DuplicateCongestedPortSolver
  override activeSubSolver: DuplicateCongestedPortSolver | null = null

  constructor(
    public readonly inputProblem: DuplicateCongestedPortPrepassSolverInput,
  ) {
    super()
  }

  override getConstructorParams(): readonly [
    DuplicateCongestedPortPrepassSolverInput,
  ] {
    return [this.inputProblem] as const
  }

  override _step(): void {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      this.updateStats()

      if (!this.activeSubSolver.solved && !this.activeSubSolver.failed) {
        return
      }

      if (this.activeSubSolver.failed) {
        const duplicateSolverError =
          this.activeSubSolver.error ?? "DuplicateCongestedPortSolver failed"
        this.failedSubSolvers = [
          ...(this.failedSubSolvers ?? []),
          this.activeSubSolver,
        ]
        this.output = {
          serializedHyperGraph: this.inputProblem.serializedHyperGraph,
          report: this.activeSubSolver.report,
          error: duplicateSolverError,
          skipped: false,
          duplicatedPortCount:
            this.activeSubSolver.report.duplicatedPorts.flatMap(
              (duplicatedPort) => duplicatedPort.duplicatePortIds,
            ).length,
        }
        this.activeSubSolver = null
        this.updateStats()
        this.solved = true
        return
      }

      this.output = this.getOutputFromDuplicateSolver(this.activeSubSolver)
      this.activeSubSolver = null
      this.updateStats()
      this.solved = true
      return
    }

    const shouldRun =
      this.inputProblem.connectionCount <=
      MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS
    if (!shouldRun) {
      this.output = {
        serializedHyperGraph: this.inputProblem.serializedHyperGraph,
        error: `Skipped for ${this.inputProblem.connectionCount} connections`,
        skipped: true,
        duplicatedPortCount: 0,
      }
      this.updateStats()
      this.solved = true
      return
    }

    const viaSizeOptions: Pick<
      TinyHyperGraphSolverOptions,
      "minViaPadDiameter"
    > = Number.isFinite(this.inputProblem.minViaPadDiameter)
      ? { minViaPadDiameter: this.inputProblem.minViaPadDiameter }
      : {}
    this.duplicateSolver = new DuplicateCongestedPortSolver(
      this.inputProblem.serializedHyperGraph,
      {
        duplicatePortProximity: 0.05,
        routeSolveOptions: {
          ...viaSizeOptions,
          USE_SPARSE_CANDIDATE_STORAGE: true,
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
          GREEDY_FINAL_ROUTE_ITERS: 4,
          MAX_ITERATIONS: Math.ceil(
            2_000_000 * Math.max(this.inputProblem.effort, 1e-2),
          ),
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
          STATIC_REACHABILITY_PRECHECK: true,
        },
      },
    )
    this.activeSubSolver = this.duplicateSolver
    this.updateStats()
  }

  override getOutput(): DuplicateCongestedPortPrepassSolverOutput {
    if (!this.output) {
      throw new Error("Duplicate congested port prepass has not completed")
    }

    return this.output
  }

  override visualize(): GraphicsObject {
    return this.duplicateSolver?.visualize() ?? super.visualize()
  }

  private getOutputFromDuplicateSolver(
    solver: DuplicateCongestedPortSolver,
  ): DuplicateCongestedPortPrepassSolverOutput {
    const duplicatedPortCount = solver.report.duplicatedPorts.reduce(
      (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
      0,
    )
    return {
      serializedHyperGraph: solver.getOutput(),
      report: solver.report,
      skipped: false,
      duplicatedPortCount,
    }
  }

  private updateStats(): void {
    this.stats = {
      ...(this.duplicateSolver?.stats ?? {}),
      duplicateCongestedPortSourceCount:
        this.output?.report?.duplicatedPorts.length ?? 0,
      duplicateCongestedPortCount: this.output?.duplicatedPortCount ?? 0,
      duplicateCongestedPortFallbackToOriginal: Boolean(this.output?.error),
      duplicateCongestedPortSkipped: Boolean(this.output?.skipped),
      duplicateCongestedPortError: this.error ?? this.output?.error,
    }
  }
}

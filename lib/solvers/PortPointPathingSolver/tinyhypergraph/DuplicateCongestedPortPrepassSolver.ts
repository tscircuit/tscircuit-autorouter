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
  effort: number
  minViaPadDiameter?: number
}

export type DuplicateCongestedPortPrepassSolverOutput = {
  serializedHyperGraph: SerializedHyperGraph
  report: DuplicateCongestedPortSolverReport
  duplicatedPortCount: number
}

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
        this.error = duplicateSolverError
        this.failed = true
        throw new Error(duplicateSolverError)
      }

      const duplicatedPortCount =
        this.activeSubSolver.report.duplicatedPorts.reduce(
          (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
          0,
        )
      this.output = {
        serializedHyperGraph: this.activeSubSolver.getOutput(),
        report: this.activeSubSolver.report,
        duplicatedPortCount,
      }
      this.activeSubSolver = null
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
}

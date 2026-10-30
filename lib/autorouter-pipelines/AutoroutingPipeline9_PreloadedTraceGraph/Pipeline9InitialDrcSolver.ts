import { SolverRuntime } from "@tscircuit/solver-utils"
import { BaseSolver } from "lib/solvers/BaseSolver"
import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
  type EvaluateRelaxedDrcResult,
} from "lib/testing/evaluate-relaxed-drc"

/** Evaluate one independent initial reference DRC snapshot in a worker. */
export class Pipeline9InitialDrcSolver extends BaseSolver {
  static readonly solverName: string = "Pipeline9InitialDrcSolver"
  private output?: EvaluateRelaxedDrcResult

  constructor(private readonly input: EvaluateRelaxedDrcInput) {
    super()
  }

  override _step(): void {
    this.output = evaluateRelaxedDrc(this.input)
    this.solved = true
  }

  getOutput(): EvaluateRelaxedDrcResult {
    if (!this.output) throw new Error("Initial DRC evaluation has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9InitialDrcSolver)

import { SolverRuntime } from "@tscircuit/solver-utils"
import { BaseSolver } from "../../solvers/BaseSolver"
import {
  Pipeline9HighDensityForceImproveSampleSolver,
  type Pipeline9HighDensityForceImproveSampleInput,
  type Pipeline9HighDensityForceImproveSampleOutput,
} from "./Pipeline9HighDensityForceImproveSampleSolver"

/** Amortize worker messages across a small group of independent node samples. */
export class Pipeline9HighDensityForceImproveBatchSolver extends BaseSolver {
  static readonly solverName = "Pipeline9HighDensityForceImproveBatchSolver"
  private output?: Pipeline9HighDensityForceImproveSampleOutput[]

  constructor(private readonly input: Pipeline9HighDensityForceImproveSampleInput[]) {
    super()
  }

  override _step(): void {
    this.output = this.input.map((input): Pipeline9HighDensityForceImproveSampleOutput => {
      const solver = new Pipeline9HighDensityForceImproveSampleSolver(input)
      solver.solve()
      if (!solver.solved || solver.failed) {
        throw new Error("Routing sample batch failed: " + solver.error)
      }
      return solver.getOutput()
    })
    this.solved = true
  }

  getOutput(): Pipeline9HighDensityForceImproveSampleOutput[] {
    if (!this.output) throw new Error("Routing sample batch has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9HighDensityForceImproveBatchSolver)

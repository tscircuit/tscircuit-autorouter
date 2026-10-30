import { SolverRuntime } from "@tscircuit/solver-utils"
import { BaseSolver } from "../BaseSolver"
import {
  Pipeline4HighDensityRepairSampleSolver,
  type Pipeline4HighDensityRepairSampleInput,
  type Pipeline4HighDensityRepairSampleOutput,
} from "./Pipeline4HighDensityRepairSampleSolver"

/** Amortize worker messages across a small group of independent node samples. */
export class Pipeline4HighDensityRepairBatchSolver extends BaseSolver {
  static readonly solverName = "Pipeline4HighDensityRepairBatchSolver"
  private output?: Pipeline4HighDensityRepairSampleOutput[]

  constructor(private readonly input: Pipeline4HighDensityRepairSampleInput[]) {
    super()
  }

  override _step(): void {
    this.output = this.input.map((input): Pipeline4HighDensityRepairSampleOutput => {
      const solver = new Pipeline4HighDensityRepairSampleSolver(input)
      solver.solve()
      if (!solver.solved || solver.failed) {
        throw new Error("Routing sample batch failed: " + solver.error)
      }
      return solver.getOutput()
    })
    this.solved = true
  }

  getOutput(): Pipeline4HighDensityRepairSampleOutput[] {
    if (!this.output) throw new Error("Routing sample batch has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline4HighDensityRepairBatchSolver)

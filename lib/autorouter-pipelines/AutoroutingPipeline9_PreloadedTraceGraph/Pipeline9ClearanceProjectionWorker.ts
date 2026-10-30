import { SolverRuntime } from "@tscircuit/solver-utils"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"

type ProjectionInput = ConstructorParameters<typeof RelaxTraceClearanceSolver>[0]
type ProjectionOutput = {
  routes: ReturnType<RelaxTraceClearanceSolver["getOutput"]>
  iterations: number
  maxIterations: number
}

/** Project one partition while retaining the rest of the board as fixed copper. */
export class Pipeline9ClearanceProjectionWorker extends BaseSolver {
  static readonly solverName = "Pipeline9ClearanceProjectionWorker"
  private output?: ProjectionOutput

  constructor(private readonly input: ProjectionInput) {
    super()
  }

  override _step(): void {
    const solver = new RelaxTraceClearanceSolver(this.input)
    solver.solve()
    if (solver.failed) throw new Error(solver.error ?? "Clearance projection failed")
    this.output = {
      routes: solver.getOutput(),
      iterations: solver.iterations,
      maxIterations: solver.MAX_ITERATIONS,
    }
    this.solved = true
  }

  getOutput(): ProjectionOutput {
    if (!this.output) throw new Error("Clearance projection worker has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9ClearanceProjectionWorker)
